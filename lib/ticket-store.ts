import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { ticketsDir } from "./paths";
import type {
  Ticket,
  TicketDraft,
  TicketEvent,
  TicketStatus,
} from "./types";
import { notifySubscribers } from "./web-push";

/**
 * 인-프로세스 티켓 이벤트 버스. SSE 라우트(`app/api/sse/route.ts`)가
 * 유일한 구독자다. store와 SSE 사이의 단일 시임 — 다른 모듈은 이 emitter에
 * 직접 emit하지 않는다 (push는 store가 처리). 이벤트 페이로드는 `TicketEvent`.
 */
export const ticketEvents = new EventEmitter();

const ALLOWED_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  OPEN: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["REVIEW", "CANCELLED"],
  REVIEW: ["DONE", "IN_PROGRESS", "CANCELLED"],
  DONE: [],
  CANCELLED: [],
};

function assertTransition(from: TicketStatus, to: TicketStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`Illegal transition: ${from} -> ${to}`);
  }
}

class TicketNotFoundError extends Error {
  constructor(id: string) {
    super(`Ticket not found: ${id}`);
  }
}

async function loadOrThrow(id: string): Promise<Ticket> {
  const t = await getTicket(id);
  if (!t) throw new TicketNotFoundError(id);
  return t;
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(ticketsDir(), { recursive: true });
}

function ticketPath(id: string): string {
  return path.join(ticketsDir(), `${id}.json`);
}

function isTicketFile(name: string): boolean {
  return /^T-\d+\.json$/.test(name);
}

async function readAllFilenames(): Promise<string[]> {
  await ensureDir();
  const entries = await fs.readdir(ticketsDir());
  return entries.filter(isTicketFile);
}

async function readTicketFile(file: string): Promise<Ticket | null> {
  try {
    const body = await fs.readFile(path.join(ticketsDir(), file), "utf8");
    return JSON.parse(body) as Ticket;
  } catch {
    return null;
  }
}

async function writeTicket(ticket: Ticket): Promise<void> {
  await ensureDir();
  await fs.writeFile(
    ticketPath(ticket.id),
    JSON.stringify(ticket, null, 2),
    "utf8",
  );
}

function emit(event: TicketEvent): void {
  ticketEvents.emit("event", event);
}

function nowIso(): string {
  return new Date().toISOString();
}

async function nextId(): Promise<string> {
  const files = await readAllFilenames();
  let max = 0;
  for (const f of files) {
    const m = /^T-(\d+)\.json$/.exec(f);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `T-${String(max + 1).padStart(3, "0")}`;
}

/**
 * 모든 티켓 조회. id 사전순 정렬, 손상된 파일은 조용히 제외.
 */
export async function listTickets(): Promise<Ticket[]> {
  const files = await readAllFilenames();
  const tickets = await Promise.all(files.map((f) => readTicketFile(f)));
  return tickets
    .filter((t): t is Ticket => t !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * 단일 티켓 조회. 미존재/손상은 null.
 */
export async function getTicket(id: string): Promise<Ticket | null> {
  try {
    const body = await fs.readFile(ticketPath(id), "utf8");
    return JSON.parse(body) as Ticket;
  } catch {
    return null;
  }
}

/**
 * 새 티켓 생성. id 미지정 시 `T-NNN`으로 발급.
 * `ticket.created` 이벤트 emit, 알림은 일으키지 않는다(REVIEW/blocked 전이에서만 발송).
 */
export async function createTicket(draft: TicketDraft): Promise<Ticket> {
  const id = draft.id ?? (await nextId());
  const now = nowIso();
  const ticket: Ticket = {
    id,
    title: draft.title,
    agent: draft.agent,
    goal: draft.goal,
    background: draft.background,
    requirements: draft.requirements ?? [],
    acceptance_criteria: draft.acceptance_criteria ?? [],
    references: draft.references,
    priority: draft.priority,
    status: draft.status ?? "OPEN",
    blocked: draft.blocked ?? false,
    blockedReason: undefined,
    created_at: now,
    updated_at: now,
  };
  await writeTicket(ticket);
  emit({ type: "ticket.created", ticket });
  return ticket;
}

type TicketPatch = Partial<
  Omit<Ticket, "id" | "created_at" | "updated_at" | "status">
>;

/**
 * 티켓 일반 필드 갱신. id/생성시각/상태는 patch가 있어도 무시(상태 전이는 `transitionTicket` 전용).
 * `ticket.updated` 이벤트 emit.
 */
export async function updateTicket(
  id: string,
  patch: TicketPatch,
): Promise<Ticket> {
  const previous = await loadOrThrow(id);
  const next: Ticket = {
    ...previous,
    ...patch,
    id: previous.id,
    status: previous.status,
    created_at: previous.created_at,
    updated_at: nowIso(),
  };
  await writeTicket(next);
  emit({ type: "ticket.updated", ticket: next, previous });
  return next;
}

/**
 * 티켓 영구 삭제. 미존재면 noop.
 * `ticket.deleted` 이벤트 emit.
 */
export async function deleteTicket(id: string): Promise<void> {
  const existing = await getTicket(id);
  if (!existing) return;
  await fs.unlink(ticketPath(id));
  emit({ type: "ticket.deleted", id });
}

/**
 * 티켓을 다음 상태로 전이한다. 불법 전이는 `IllegalTransitionError`.
 * IN_PROGRESS가 아닌 상태로 가면 blocked/blockedReason 자동 클리어.
 * REVIEW 진입 시 Web Push 발송(best-effort).
 */
export async function transitionTicket(
  id: string,
  next: TicketStatus,
): Promise<Ticket> {
  const previous = await loadOrThrow(id);
  assertTransition(previous.status, next);
  const stayingInProgress = next === "IN_PROGRESS";
  const updated: Ticket = {
    ...previous,
    status: next,
    blocked: stayingInProgress ? previous.blocked : false,
    blockedReason: stayingInProgress ? previous.blockedReason : undefined,
    updated_at: nowIso(),
  };
  await writeTicket(updated);
  emit({ type: "ticket.updated", ticket: updated, previous });
  if (next === "REVIEW") {
    void notifySubscribers(updated, "review").catch(() => {});
  }
  return updated;
}

/**
 * blocked 플래그를 설정한다. blocked=true이고 reason이 있으면 함께 저장,
 * blocked=false면 reason은 무시되고 클리어. blocked=true 진입 시 Web Push 발송(best-effort).
 */
export async function setBlocked(
  id: string,
  blocked: boolean,
  reason?: string,
): Promise<Ticket> {
  const previous = await loadOrThrow(id);
  const updated: Ticket = {
    ...previous,
    blocked,
    blockedReason: blocked ? reason : undefined,
    updated_at: nowIso(),
  };
  await writeTicket(updated);
  emit({ type: "ticket.updated", ticket: updated, previous });
  if (blocked) {
    void notifySubscribers(updated, "blocked").catch(() => {});
  }
  return updated;
}
