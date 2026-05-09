import {
  PushSubscriptionSchema,
  PushUnsubscribeSchema,
} from "@/lib/schemas";
import {
  addSubscription,
  getVapidPublicKey,
  removeSubscription,
} from "@/lib/web-push";
import type { PushSubscription } from "web-push";

import { withMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function _GET() {
  return Response.json({ publicKey: getVapidPublicKey() });
}

async function _POST(req: Request) {
  const parsed = PushSubscriptionSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json(
      { error: "invalid subscription", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  await addSubscription(parsed.data as PushSubscription);
  return new Response(null, { status: 201 });
}

async function _DELETE(req: Request) {
  const parsed = PushUnsubscribeSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  await removeSubscription(parsed.data.endpoint);
  return new Response(null, { status: 204 });
}

export const GET = withMetrics("/api/push", _GET);

export const POST = withMetrics("/api/push", _POST);

export const DELETE = withMetrics("/api/push", _DELETE);
