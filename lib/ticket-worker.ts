import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { effectiveSettings } from "@/lib/app-settings";
import { getProject } from "@/lib/project-store";
import {
  getTicket,
  listTickets,
  ticketEvents,
  transitionTicket,
  updateTicket,
} from "@/lib/ticket-store";
import { ticketsDir } from "@/lib/paths";
import type { Ticket, TicketEvent } from "@/lib/types";

/**
 * 워커 모듈-스코프 상태. globalThis 에 hoist해 HMR로 모듈이 중복 evaluate돼도
 * 단일 부팅·단일 inFlight 집합을 유지한다 (`ticketEvents` hoist와 같은 이유).
 */
type WorkerState = {
  isStarted: boolean;
  inFlight: Set<string>;
  inFlightChildren: Map<string, { child: ChildProcess; pid: number }>;
};
const __G = globalThis as unknown as { __ticketWorkerState?: WorkerState };
const __state: WorkerState =
  __G.__ticketWorkerState ??
  (__G.__ticketWorkerState = {
    isStarted: false,
    inFlight: new Set(),
    inFlightChildren: new Map(),
  });

/** 현재 워커가 spawn해서 진행 중인 티켓 id 집합. (HMR-safe alias) */
const inFlight = __state.inFlight;
/** inFlight 티켓 → 자식 프로세스 핸들. 'exit' 리스너에서 자동 정리. */
const inFlightChildren = __state.inFlightChildren;

/**
 * 부팅 시 호출되는 진입점. 멱등 — 여러 번 호출되어도 한 번만 실제로 시작한다.
 * 1) 기존 OPEN 티켓 픽업 시도, 2) ticket.created 이벤트 구독,
 * 3) watchdog 인터벌 등록.
 */
export function startTicketWorker(): void {
  if (__state.isStarted) return;
  __state.isStarted = true;

  void pickupOpenTickets().catch((err) => {
    console.error("[ticket-worker] initial pickup failed:", err);
  });

  ticketEvents.on("event", (ev: TicketEvent) => {
    // 새 티켓: 무조건 시도. 상태 변경: OPEN/IN_PROGRESS인데 아직 세션이 없으면 시도.
    // 워커 자신은 spawn 직전 currentSessionId를 set하므로 무한 루프가 발생하지 않는다.
    const candidate =
      ev.type === "ticket.created"
        ? ev.ticket
        : ev.type === "ticket.updated"
          ? ev.ticket
          : null;
    if (!candidate) return;
    void tryClaim(candidate).catch((err) => {
      console.error(`[ticket-worker] claim failed for ${candidate.id}:`, err);
    });
  });

  setInterval(() => {
    void checkStuckTickets().catch((err) => {
      console.error("[ticket-worker] watchdog failed:", err);
    });
    reapDeadChildren();
  }, 60_000).unref();
}

/**
 * 죽은 자식의 inFlight 슬롯을 회수한다 (60초 watchdog에서 호출).
 * - `child.exitCode !== null` 또는 `child.killed`이면 명백히 죽음
 * - 둘 다 미세 차이를 못 잡았으면 `process.kill(pid, 0)`로 OS 레벨 확인 (시그널 0 = 존재 확인)
 * 회수 후 슬롯이 비면 OPEN 티켓 재픽업을 트리거.
 */
function reapDeadChildren(): void {
  let reaped = 0;
  for (const [ticketId, { child, pid }] of inFlightChildren) {
    let alive = child.exitCode === null && !child.killed;
    if (alive) {
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
    }
    if (!alive) {
      inFlightChildren.delete(ticketId);
      inFlight.delete(ticketId);
      reaped++;
      console.warn(
        `[ticket-worker] reaped orphaned child for ${ticketId} (pid=${pid})`,
      );
    }
  }
  if (reaped > 0) {
    void pickupOpenTickets().catch((err) => {
      console.error("[ticket-worker] post-reap pickup failed:", err);
    });
  }
}

/**
 * Headless Claude Code 자식 프로세스 spawn 옵션.
 */
export type SpawnHeadlessOptions = {
  /** 자식 프로세스의 cwd. 프로젝트 작업 디렉토리. */
  cwd: string;
  /** 세션 id (UUID). resume=false면 `--session-id`, true면 `--resume`. */
  sessionId: string;
  /**
   * 자식에게 전달할 사용자 프롬프트. resume=true에서도 다음 입력으로 작동.
   * 미지정 시 빈 인자 (resume 후 추가 입력 없음).
   */
  prompt?: string;
  /** true면 기존 세션 이어가기. false/미지정 시 새 세션 생성. */
  resume?: boolean;
  /** 워크플로우 OS의 티켓 id. 자식 환경변수 TICKET_ID에 주입. */
  ticketId: string;
  /** stdout/stderr를 append할 로그 파일 절대 경로. 디렉토리는 자동 생성. */
  logPath: string;
};

/**
 * Headless Claude Code 자식 프로세스를 detached/unref로 spawn.
 * 부모(Next.js 서버)와 생명주기가 분리된다. 종료 감지는 Stop hook이 담당.
 * 답변(answer) 라우트와 워처가 동일 진입점으로 사용한다.
 */
export function spawnHeadlessClaude(opts: SpawnHeadlessOptions): void {
  const { cwd, sessionId, prompt, resume, ticketId, logPath } = opts;
  void (async () => {
    const settings = await effectiveSettings();
    const claudeBin = settings.claudeBinaryPath || "claude";
    const port = process.env.PORT ?? "3000";

    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await mergeStopHook(cwd);

    const args: string[] = ["-p"];
    if (resume) {
      args.push("--resume", sessionId);
    } else {
      args.push("--session-id", sessionId);
    }
    // 사용자 설정의 permissionMode를 그대로 사용. 헤드리스라 권한 프롬프트가 뜨면
     // 그대로 차단되니 사용자가 명시적으로 고른 모드 (`bypassPermissions` 등)를 존중한다.
    args.push(
      "--permission-mode",
      settings.permissionMode,
      "--append-system-prompt",
      "You are running inside Claude Workflow OS as an automated ticket worker. Use the work-ticket skill.",
    );
    if (prompt && prompt.trim()) {
      args.push(prompt);
    }

    const out = createWriteStream(logPath, { flags: "a" });
    out.write(
      `\n[${new Date().toISOString()}] spawn ${resume ? "resume" : "new"} session=${sessionId} ticket=${ticketId}\n`,
    );

    const child = spawn(claudeBin, args, {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CLAUDE_WORKFLOW_OS_URL: `http://localhost:${port}`,
        TICKET_ID: ticketId,
      },
    });
    child.stdout?.pipe(out);
    child.stderr?.pipe(out);
    if (typeof child.pid === "number") {
      inFlightChildren.set(ticketId, { child, pid: child.pid });
    }
    // 자식 종료 시 inFlight 슬롯 자동 회수 — 정상 종료/실패/즉시 죽음 모두 동일.
    // unref() 후에도 'exit' 리스너는 부모 프로세스가 살아 있는 동안 동작한다.
    child.on("exit", (code, signal) => {
      out.write(
        `\n[${new Date().toISOString()}] exit code=${code} signal=${signal} ticket=${ticketId}\n`,
      );
      inFlight.delete(ticketId);
      inFlightChildren.delete(ticketId);
      // 비정상 종료(코드 != 0, signal로 죽은 경우 포함) → 사용자 회수.
      // Stop hook이 정상 케이스를 처리하므로 여기서는 *에러* 상황만 다룬다.
      if ((code !== null && code !== 0) || signal) {
        void recoverAfterAbnormalExit(ticketId, code, signal).catch((err) => {
          console.error(
            `[ticket-worker] abnormal-exit recovery failed for ${ticketId}:`,
            err,
          );
        });
      }
      // 슬롯이 비었으니 대기 중 OPEN 티켓을 한 번 더 훑어 다음 차례 진행.
      void pickupOpenTickets().catch((err) => {
        console.error("[ticket-worker] post-exit pickup failed:", err);
      });
    });
    child.unref();
  })().catch((err) => {
    console.error(
      `[ticket-worker] spawnHeadlessClaude failed for ${ticketId}:`,
      err,
    );
  });
}

/**
 * 자식이 비정상 종료한 직후 호출. 티켓이 IN_PROGRESS면 사용자 회수 흐름으로 보낸다.
 * - pendingQuestion에 실패 사유 기록 → 카드에 답변 폼이 노출됨 (답변하면 자동 재시도)
 * - REVIEW로 전이 → Web Push 발송으로 사용자 즉시 인지
 * 이미 다른 상태로 전이됐으면 noop (사용자 수동 조작/Stop hook 우선).
 */
async function recoverAfterAbnormalExit(
  ticketId: string,
  code: number | null,
  signal: NodeJS.Signals | null,
): Promise<void> {
  const ticket = await getTicket(ticketId);
  if (!ticket) return;
  if (ticket.status !== "IN_PROGRESS") return;
  const reason =
    code !== null && code !== 0
      ? `워커가 비정상 종료했습니다 (exit=${code}). 답변을 입력하면 그 내용으로 다시 시도합니다.`
      : `워커가 시그널 ${signal ?? "?"}로 종료했습니다. 답변을 입력하면 다시 시도합니다.`;
  try {
    await updateTicket(ticketId, { pendingQuestion: reason });
    await transitionTicket(ticketId, "REVIEW");
  } catch (err) {
    console.error(
      `[ticket-worker] abnormal recovery PATCH failed for ${ticketId}:`,
      err,
    );
  }
}

/**
 * IN_PROGRESS이지만 ticketWatchdogMinutes 이상 갱신이 없는 티켓을
 * pendingApproval=true + REVIEW로 회수한다. 0 이하 설정 시 비활성.
 */
export async function checkStuckTickets(): Promise<void> {
  const settings = await effectiveSettings();
  const minutes = settings.ticketWatchdogMinutes;
  if (minutes <= 0) return;
  const cutoff = Date.now() - minutes * 60_000;
  const tickets = await listTickets();
  for (const t of tickets) {
    if (t.status !== "IN_PROGRESS") continue;
    const updated = Date.parse(t.updated_at);
    if (!Number.isFinite(updated) || updated > cutoff) continue;
    try {
      await updateTicket(t.id, { pendingApproval: true });
      await transitionTicket(t.id, "REVIEW");
      inFlight.delete(t.id);
    } catch (err) {
      console.error(`[ticket-worker] watchdog recover failed ${t.id}:`, err);
    }
  }
}

/**
 * 부팅 직후 OPEN 상태로 남아있는 티켓들을 한도 안에서 픽업.
 */
async function pickupOpenTickets(): Promise<void> {
  const tickets = await listTickets();
  for (const t of tickets) {
    if (t.status !== "OPEN") continue;
    await tryClaim(t);
  }
}

/**
 * 티켓 한 건을 동시성 한도 안에서 spawn 시도. 한도 초과/중복/projectId 부재 시 skip.
 */
async function tryClaim(ticket: Ticket): Promise<void> {
  // OPEN(미시작) 또는 사용자가 수동 시작한 IN_PROGRESS(아직 세션 미할당) 둘 다 spawn.
  const claimable =
    ticket.status === "OPEN" ||
    (ticket.status === "IN_PROGRESS" && !ticket.currentSessionId);
  if (!claimable) return;
  if (inFlight.has(ticket.id)) return;
  if (!ticket.projectId) {
    console.warn(
      `[ticket-worker] skip ${ticket.id}: projectId 미지정`,
    );
    return;
  }
  const settings = await effectiveSettings();
  if (inFlight.size >= settings.maxConcurrentTickets) return;

  const cwd = await resolveCwd(ticket.projectId);
  if (!cwd) {
    console.warn(
      `[ticket-worker] skip ${ticket.id}: project ${ticket.projectId} 해석 실패`,
    );
    return;
  }

  inFlight.add(ticket.id);
  try {
    const sessionId = crypto.randomUUID();
    const logPath = path.join(ticketsDir(), ".logs", `${ticket.id}.log`);
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await updateTicket(ticket.id, {
      currentSessionId: sessionId,
      workerLog: logPath,
    });
    spawnHeadlessClaude({
      cwd,
      sessionId,
      prompt: `Use the work-ticket skill to handle ticket ${ticket.id}. Read .claude/skills/work-ticket/SKILL.md and follow it precisely. Ticket id: ${ticket.id}.`,
      ticketId: ticket.id,
      logPath,
    });
  } catch (err) {
    inFlight.delete(ticket.id);
    throw err;
  }
}

/**
 * 프로젝트 id → 자식 프로세스 cwd 해석.
 * project.workDir 우선, 없으면 claudeRoot가 `.claude`로 끝나면 그 부모, 아니면 자기 자신.
 */
async function resolveCwd(projectId: string): Promise<string | null> {
  try {
    const project = await getProject(projectId);
    if (project.workDir) return project.workDir;
    const root = project.claudeRoot;
    if (root.endsWith(`${path.sep}.claude`)) return path.dirname(root);
    return root;
  } catch {
    return null;
  }
}

/**
 * cwd의 `.claude/settings.local.json`에 워크플로우 OS Stop hook을 idempotent하게 머지.
 * 기존 hooks를 보존하면서 같은 command가 이미 있으면 추가하지 않는다.
 */
async function mergeStopHook(cwd: string): Promise<void> {
  const claudeDir = path.join(cwd, ".claude");
  const settingsPath = path.join(claudeDir, "settings.local.json");
  const hookScript = path.resolve(
    process.cwd(),
    "scripts",
    "ticket-stop-hook.mjs",
  );
  const command = `node ${JSON.stringify(hookScript)}`;

  await fs.mkdir(claudeDir, { recursive: true });
  let parsed: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    const j = JSON.parse(raw);
    if (j && typeof j === "object") parsed = j as Record<string, unknown>;
  } catch {
    // 파일 없거나 손상 — 빈 객체에서 시작.
  }

  const hooks = (parsed.hooks as Record<string, unknown> | undefined) ?? {};
  const stopList = Array.isArray(hooks.Stop)
    ? (hooks.Stop as unknown[])
    : [];
  const alreadyHas = stopList.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const inner = (entry as { hooks?: unknown[] }).hooks;
    if (!Array.isArray(inner)) return false;
    return inner.some(
      (h) =>
        h &&
        typeof h === "object" &&
        (h as { command?: unknown }).command === command,
    );
  });
  if (alreadyHas) return;

  const nextStop = [
    ...stopList,
    {
      hooks: [
        {
          type: "command",
          command,
        },
      ],
    },
  ];
  const next = {
    ...parsed,
    hooks: {
      ...hooks,
      Stop: nextStop,
    },
  };
  await fs.writeFile(settingsPath, JSON.stringify(next, null, 2), "utf8");
}

/**
 * 진행 중 티켓에서 한 건을 제거한다 (테스트/외부 회수용).
 */
export function releaseInFlight(ticketId: string): void {
  inFlight.delete(ticketId);
}
