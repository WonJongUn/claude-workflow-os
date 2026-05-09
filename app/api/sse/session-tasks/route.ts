import {
  ensureWatcher,
  sessionTaskEvents,
  type SessionTaskNotification,
} from "@/lib/session-watcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 세션 jsonl의 TaskCreate / TaskUpdate 변경을 실시간으로 흘려주는 SSE 채널.
 * 첫 클라이언트 연결 시 watcher를 lazy 시작하고, 이후 연결은 같은 EventEmitter를 share.
 */
export async function GET() {
  await ensureWatcher();
  const encoder = new TextEncoder();
  let onEvent: ((ev: SessionTaskNotification) => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // controller closed — 연결 끊김.
        }
      };

      onEvent = (ev) => send(ev);
      sessionTaskEvents.on("event", onEvent);

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
      if (onEvent) sessionTaskEvents.off("event", onEvent);
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
