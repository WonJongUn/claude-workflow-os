import {
  BlockedBodySchema,
  TicketUpdateSchema,
  TransitionBodySchema,
} from "@/lib/schemas";
import {
  deleteTicket,
  getTicket,
  setBlocked,
  transitionTicket,
  updateTicket,
} from "@/lib/ticket-store";

import { withMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorStatus(message: string): number {
  if (message.startsWith("Illegal transition")) return 409;
  if (message.startsWith("Acceptance criteria not satisfied")) return 409;
  if (message.startsWith("Ticket not found")) return 404;
  return 400;
}

async function _GET(
  _req: Request,
  ctx: RouteContext<"/api/tickets/[id]">,
) {
  const { id } = await ctx.params;
  const ticket = await getTicket(id);
  if (!ticket) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(ticket);
}

async function _PATCH(
  req: Request,
  ctx: RouteContext<"/api/tickets/[id]">,
) {
  const { id } = await ctx.params;
  const raw = await req.json();
  try {
    const transition = TransitionBodySchema.safeParse(raw);
    if (transition.success) {
      const ticket = await transitionTicket(id, transition.data.transition);
      return Response.json(ticket);
    }
    const blocked = BlockedBodySchema.safeParse(raw);
    if (blocked.success) {
      const ticket = await setBlocked(
        id,
        blocked.data.blocked,
        blocked.data.reason,
      );
      return Response.json(ticket);
    }
    const update = TicketUpdateSchema.safeParse(raw);
    if (!update.success) {
      return Response.json(
        { error: "invalid body", issues: update.error.issues },
        { status: 400 },
      );
    }
    const ticket = await updateTicket(id, update.data);
    return Response.json(ticket);
  } catch (err) {
    const message = err instanceof Error ? err.message : "error";
    return Response.json({ error: message }, { status: errorStatus(message) });
  }
}

async function _DELETE(
  _req: Request,
  ctx: RouteContext<"/api/tickets/[id]">,
) {
  const { id } = await ctx.params;
  await deleteTicket(id);
  return new Response(null, { status: 204 });
}

export const GET = withMetrics("/api/tickets/:id", _GET);

export const PATCH = withMetrics("/api/tickets/:id", _PATCH);

export const DELETE = withMetrics("/api/tickets/:id", _DELETE);
