import fs from "node:fs/promises";
import path from "node:path";
import webpush, { type PushSubscription } from "web-push";
import { ticketsDir } from "./paths";
import type { Ticket } from "./types";

const SUBS_FILE = ".subscriptions.json";

function subsPath(): string {
  return path.join(ticketsDir(), SUBS_FILE);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(ticketsDir(), { recursive: true });
}

async function readSubs(): Promise<PushSubscription[]> {
  try {
    const body = await fs.readFile(subsPath(), "utf8");
    const parsed = JSON.parse(body) as PushSubscription[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeSubs(subs: PushSubscription[]): Promise<void> {
  await ensureDir();
  await fs.writeFile(subsPath(), JSON.stringify(subs, null, 2), "utf8");
}

export async function listSubscriptions(): Promise<PushSubscription[]> {
  return readSubs();
}

export async function addSubscription(sub: PushSubscription): Promise<void> {
  const subs = await readSubs();
  if (!subs.some((s) => s.endpoint === sub.endpoint)) {
    subs.push(sub);
    await writeSubs(subs);
  }
}

export async function removeSubscription(endpoint: string): Promise<void> {
  const subs = await readSubs();
  const next = subs.filter((s) => s.endpoint !== endpoint);
  if (next.length !== subs.length) {
    await writeSubs(next);
  }
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

let vapidConfigured = false;
function configureVapid(): boolean {
  if (vapidConfigured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

export async function notifySubscribers(
  ticket: Ticket,
  kind: "review" | "blocked",
): Promise<void> {
  if (!configureVapid()) {
    console.warn("[web-push] VAPID env vars missing; skipping notify");
    return;
  }
  const title =
    kind === "review"
      ? `검토 요청: ${ticket.title}`
      : `차단됨: ${ticket.title}`;
  const body =
    kind === "blocked" && ticket.blockedReason
      ? ticket.blockedReason
      : ticket.goal;
  const payload = JSON.stringify({ title, body, ticketId: ticket.id });
  const subs = await readSubs();
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload);
      } catch (err) {
        console.warn("[web-push] send failed", err);
      }
    }),
  );
}
