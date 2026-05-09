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

/** 등록된 모든 Web Push 구독 목록을 디스크에서 읽어 반환. 파일 없으면 빈 배열. */
export async function listSubscriptions(): Promise<PushSubscription[]> {
  return readSubs();
}

/** 신규 구독을 등록. endpoint 기준 중복은 무시 (idempotent). */
export async function addSubscription(sub: PushSubscription): Promise<void> {
  const subs = await readSubs();
  if (!subs.some((s) => s.endpoint === sub.endpoint)) {
    subs.push(sub);
    await writeSubs(subs);
  }
}

/** endpoint와 일치하는 구독을 제거. 일치 없으면 no-op. */
export async function removeSubscription(endpoint: string): Promise<void> {
  const subs = await readSubs();
  const next = subs.filter((s) => s.endpoint !== endpoint);
  if (next.length !== subs.length) {
    await writeSubs(next);
  }
}

/**
 * 클라이언트가 PushManager.subscribe에 사용할 VAPID 공개 키.
 * env 미설정 시 null — 라우트는 503 등으로 응답한다.
 */
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

/**
 * 등록된 모든 구독자에게 티켓 이벤트 알림을 발송한다.
 * VAPID 환경변수 미설정 시 경고만 남기고 swallow (개발 편의).
 * 개별 발송 실패도 swallow — 한 구독의 만료가 전체를 막지 않게.
 * @param ticket 알림 컨텍스트가 될 티켓.
 * @param kind "review"는 REVIEW 진입, "blocked"는 IN_PROGRESS에서 blocked=true로 전환된 경우.
 */
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
