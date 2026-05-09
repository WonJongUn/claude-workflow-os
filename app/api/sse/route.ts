import { listTickets, ticketEvents } from "@/lib/ticket-store";
import type { TicketEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  let onEvent: ((event: TicketEvent) => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // controller closed
        }
      };

      const snapshot = await listTickets();
      send({ type: "snapshot", tickets: snapshot });

      onEvent = (event: TicketEvent) => send(event);
      ticketEvents.on("event", onEvent);

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          // ignore
        }
      }, 25000);
    },
    cancel() {
      if (onEvent) ticketEvents.off("event", onEvent);
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
