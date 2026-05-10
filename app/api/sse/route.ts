import { listTickets, ticketEvents } from "@/lib/ticket-store";
import {
  ensureWatcher,
  sessionTaskEvents,
  type SessionTaskNotification,
} from "@/lib/session-watcher";
import {
  CHAT_GLOBAL,
  subscribeChat,
  type ChatBusEnvelope,
} from "@/lib/chat-bus";
import type { TicketEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 단일 SSE 채널. 티켓 / 세션 태스크 알림 / 챗봇 이벤트를 *한 connection으로* multiplex한다.
 *
 * 메시지 envelope: `{ topic: "ticket" | "session-task" | "chat", ...payload }`
 *
 * 분리하지 않는 이유: 브라우저 HTTP/1.1 6연결 한도. 영구 점유 SSE를 1개로 줄이면
 * 폴링 burst가 큐에 안 밀려 health 등 짧은 요청이 stall되지 않는다.
 *
 * snapshot은 ticket에만 있다 (보드 초기 로드용). 다른 도메인은 이벤트 push 전용 +
 * 별도 init/snapshot이 필요하면 도메인 GET 라우트에서 따로 받아간다 (chat history 등).
 */
export async function GET() {
  await ensureWatcher();
  const encoder = new TextEncoder();
  let onTicket: ((event: TicketEvent) => void) | null = null;
  let onSessionTask: ((ev: SessionTaskNotification) => void) | null = null;
  let unsubChat: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // controller closed — 연결 끊김.
        }
      };

      const snapshot = await listTickets();
      send({ topic: "ticket", type: "snapshot", tickets: snapshot });

      onTicket = (event: TicketEvent) => send({ topic: "ticket", ...event });
      ticketEvents.on("event", onTicket);

      onSessionTask = (ev) => send({ topic: "session-task", ...ev });
      sessionTaskEvents.on("event", onSessionTask);

      unsubChat = subscribeChat(CHAT_GLOBAL, (env) =>
        send({ topic: "chat", ...(env as ChatBusEnvelope) }),
      );

      // 일부 프록시는 짧은 idle을 끊어버리므로 25s 마다 keep-alive.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          // ignore
        }
      }, 25_000);
    },
    cancel() {
      if (onTicket) ticketEvents.off("event", onTicket);
      if (onSessionTask) sessionTaskEvents.off("event", onSessionTask);
      if (unsubChat) unsubChat();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
