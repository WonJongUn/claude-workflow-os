import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { ticketsDir } from "./paths";
import type {
  AcceptanceCriterion,
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
 *
 * globalThis 에 hoist하는 이유: Next dev HMR이 `lib/ticket-store.ts` 를 두 컨텍스트
 * (instrumentation 부팅 vs route 핸들러 번들)에서 따로 evaluate하면 module-scope
 * `new EventEmitter()` 가 *각각* 만들어져 emit/listen 인스턴스가 어긋난다 — 워커가
 * `ticket.created` 를 못 받아 자동 spawn이 안 되는 증상이 났다. globalThis 캐시는
 * HMR/duplicate evaluation을 가로지르며 동일 객체를 보장한다.
 */
const G = globalThis as unknown as { __ticketEvents?: EventEmitter };
export const ticketEvents: EventEmitter = G.__ticketEvents ?? new EventEmitter();
ticketEvents.setMaxListeners(50);
if (!G.__ticketEvents) G.__ticketEvents = ticketEvents;

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
    const raw = JSON.parse(body) as Ticket & {
      acceptance_criteria?: unknown;
    };
    return normalizeTicket(raw);
  } catch {
    return null;
  }
}

/**
 * 디스크 → 도메인 형태 정규화. 레거시 `acceptance_criteria: string[]`을
 * `{text, checked:false}[]`로 변환. 신규 파일은 그대로 통과.
 */
function normalizeTicket(raw: Ticket & { acceptance_criteria?: unknown }): Ticket {
  const ac = normalizeAcceptanceCriteria(raw.acceptance_criteria);
  return { ...raw, acceptance_criteria: ac };
}

function normalizeAcceptanceCriteria(raw: unknown): AcceptanceCriterion[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (typeof item === "string") {
      const text = item.trim();
      return text ? [{ text, checked: false }] : [];
    }
    if (item && typeof item === "object" && "text" in item) {
      const obj = item as { text?: unknown; checked?: unknown };
      const text = typeof obj.text === "string" ? obj.text.trim() : "";
      if (!text) return [];
      return [{ text, checked: obj.checked === true }];
    }
    return [];
  });
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
    // draft가 zod를 안 거친 내부 호출이거나 옛 형태일 수도 있어 한 번 더 정규화.
    acceptance_criteria: normalizeAcceptanceCriteria(draft.acceptance_criteria),
    references: draft.references,
    priority: draft.priority,
    status: draft.status ?? "OPEN",
    blocked: draft.blocked ?? false,
    blockedReason: undefined,
    projectId: draft.projectId,
    created_at: now,
    updated_at: now,
  };
  await writeTicket(ticket);
  emit({ type: "ticket.created", ticket });
  return ticket;
}

type Nullable<T> = { [K in keyof T]?: T[K] | null };
type TicketPatch = Nullable<
  Omit<Ticket, "id" | "created_at" | "updated_at" | "status">
>;

/**
 * 티켓 일반 필드 갱신. id/생성시각/상태는 patch가 있어도 무시(상태 전이는 `transitionTicket` 전용).
 * 패치 값이 `null`이면 해당 필드를 `undefined`로 클리어한다 (스킬이 명시적 클리어 시 사용).
 * `ticket.updated` 이벤트 emit.
 */
export async function updateTicket(
  id: string,
  patch: TicketPatch,
): Promise<Ticket> {
  const previous = await loadOrThrow(id);
  const normalized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    normalized[k] = v === null ? undefined : v;
  }
  const next: Ticket = {
    ...previous,
    ...(normalized as Partial<Ticket>),
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
  // DONE 전이는 모든 acceptance_criteria가 체크된 경우에만. 빈 배열은 통과(레거시 호환).
  if (next === "DONE" && previous.acceptance_criteria.length > 0) {
    const unchecked = previous.acceptance_criteria.filter((c) => !c.checked);
    if (unchecked.length > 0) {
      throw new Error(
        `Acceptance criteria not satisfied: ${unchecked.length}개 미체크 항목이 있습니다`,
      );
    }
  }
  const stayingInProgress = next === "IN_PROGRESS";
  const terminal = next === "DONE" || next === "CANCELLED";
  const updated: Ticket = {
    ...previous,
    status: next,
    blocked: stayingInProgress ? previous.blocked : false,
    blockedReason: stayingInProgress ? previous.blockedReason : undefined,
    // 종결 상태에선 사용자 입력 대기 플래그가 의미 없음 → 자동 클리어.
    pendingApproval: terminal ? false : previous.pendingApproval,
    pendingQuestion: terminal ? undefined : previous.pendingQuestion,
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
