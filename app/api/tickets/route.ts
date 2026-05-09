import { TicketDraftSchema } from "@/lib/schemas";
import { createTicket, listTickets } from "@/lib/ticket-store";

import { withMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function _GET() {
  const tickets = await listTickets();
  return Response.json(tickets);
}

async function _POST(req: Request) {
  const parsed = TicketDraftSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const ticket = await createTicket(parsed.data);
  return Response.json(ticket, { status: 201 });
}

export const GET = withMetrics("/api/tickets", _GET);

export const POST = withMetrics("/api/tickets", _POST);
