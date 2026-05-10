import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createCache } from "@/lib/cache";
import { projectRoot } from "@/lib/paths";
import {
  extractTaskResultId,
  extractTimestamp,
  stringField,
  walkToolUses,
} from "@/lib/session-tasks";

/**
 * 세션 jsonl(`~/.claude/projects/<encoded>/<sessionId>.jsonl`)을 추적해
 * TaskCreate / TaskUpdate 도구 호출이 새로 기록될 때마다 in-process 이벤트로 emit한다.
 *
 * - 어떤 클라이언트가 SSE로 들어온 시점에 lazy 시작 (`ensureWatcher`).
 * - 한 프로세스에서 한 번만 켜지고 절대 끄지 않는다 — 로컬 도구라 라이프사이클이 단순.
 * - 파일별 lastOffset을 메모리에 보유 → 재시작 시 기존 파일은 *현재 길이를 시작점*으로 잡아
 *   과거 이벤트를 토스트로 다시 쏟지 않는다 (사용자 경험: 이미 본 알림 재발송 금지).
 */

/** 클라 토스트로 변환되는 단일 알림 이벤트. */
export type SessionTaskNotification = {
  /** 도구 호출 종류 — 토스트 헤더에 직결 (생성/변경). */
  kind: "create" | "update";
  /** 어느 세션의 jsonl에서 발생했는지 (sessionId = jsonl basename). */
  sessionId: string;
  /** 세션 jsonl 절대 경로 — 클라가 세션 상세로 이동할 때 사용. */
  filePath: string;
  /** TaskCreate/Update의 taskId 인자 (없으면 빈 문자열). */
  taskId: string;
  /** 변경 후 status — TaskUpdate 한정, TaskCreate는 "pending". */
  status?: "pending" | "in_progress" | "completed" | "deleted";
  /** subject(있으면). 토스트 본문 표시용. */
  subject?: string;
  /** 이벤트 발생 시각 (epoch ms). 0이면 알 수 없음. */
  ts: number;
};

/**
 * 외부 구독자(SSE 라우트)가 'event'를 listen해 클라에 흘려보낸다.
 * Note: 한 프로세스 내 in-memory bus. 멀티 인스턴스로 가면 redis pub/sub 등 필요.
 *
 * globalThis hoist 이유: Next dev HMR이 모듈을 중복 evaluate해 emitter가 갈라지면
 * watcher의 emit과 SSE 라우트의 listen이 어긋나 알림 누락. ticket-store.ts와 동일 패턴.
 */
const G = globalThis as unknown as { __sessionTaskEvents?: EventEmitter };
export const sessionTaskEvents: EventEmitter =
  G.__sessionTaskEvents ?? new EventEmitter();
sessionTaskEvents.setMaxListeners(50);
if (!G.__sessionTaskEvents) G.__sessionTaskEvents = sessionTaskEvents;

/** 파일별 마지막으로 읽은 byte offset. 다음 변경 시 그 지점부터만 read. */
const offsetByPath = new Map<string, number>();
/**
 * 세션 + taskId별 마지막으로 본 subject.
 * TaskUpdate input에는 보통 status만 들어있어 알림에 제목이 비어 시인성이 떨어진다.
 * TaskCreate가 subject를 명시할 때 캐시해두고, 다음 update에 빈 subject면 채워준다.
 * 키 형식: `${sessionId}:${taskId}`.
 *
 * 다른 이 모듈의 Map들(`offsetByPath`, `pendingCreate`, `partialByPath`, `readChainByPath`)은
 * 캐시가 아니라 watcher의 *상태 머신* (offset/카운터/스트림 버퍼/in-flight queue)이라 NamedCache로 옮기지 않는다.
 */
const subjectCache = createCache<string, string>("session-watcher.subject");
/**
 * TaskCreate가 받은 *진짜* harness taskId를 회수하기 위한 보류 버퍼.
 * 키: `${sessionId}:${tool_use_id}`. 같은 라인 또는 후속 라인의 tool_result(envelope.toolUseResult.task.id)가
 * 도착하면 진짜 id로 알림 emit. 도착 전엔 emit하지 않는다 — UI가 placeholder id를
 * 진짜 id로 갱신하는 채널이 없기 때문.
 *
 * Claude Code 2.1+에서 taskId는 harness 전역 시퀀스라 우리가 1..N으로 합성하면
 * TaskUpdate.input.taskId 와 영원히 어긋난다.
 */
const pendingCreate = new Map<
  string,
  { subject: string | undefined; ts: number }
>();
/**
 * 직전 read에서 line 경계로 종결되지 않고 남은 미완성 tail.
 * 다음 read에서 prepend해 join함으로써 jsonl이 line-aligned로 도착하지 않아도
 * 라인 단위 파싱이 한 줄도 누락 없이 동작한다.
 */
const partialByPath = new Map<string, string>();
/**
 * 같은 파일에 대한 readNew를 직렬화하는 in-flight Promise.
 * fs.watch가 같은 파일에 burst로 fire해도 race 없이 순차 처리된다.
 */
const readChainByPath = new Map<string, Promise<void>>();
/**
 * 세션별 직전 TodoWrite 스냅샷. content → status 매핑.
 * TodoWrite는 호출 때마다 todos 배열 *전체*를 갱신하므로(stable id 없음),
 * content를 안정 키로 삼아 새 항목 / 상태 변경을 diff한다.
 */
const todoSnapshotBySession = new Map<string, Map<string, string>>();

/** TodoWrite의 status 필드를 SessionTaskNotification.status union으로 좁힌다. */
function validTaskStatus(
  s: string,
): "pending" | "in_progress" | "completed" | "deleted" | undefined {
  return s === "pending" ||
    s === "in_progress" ||
    s === "completed" ||
    s === "deleted"
    ? s
    : undefined;
}

/**
 * watcher 시작 플래그 + FSWatcher 인스턴스를 globalThis에 보관.
 * dev HMR로 모듈이 reload돼도 fs.watch가 누적되지 않게 한다 — 이전 watcher를 close하고
 * 다시 만든다. (모듈 스코프 변수면 reload마다 새 watcher가 추가되며 같은 jsonl 변경을
 * N번 emit → 알림 중복.)
 */
declare global {

  var __sessionWatcherStarted: boolean | undefined;

  var __sessionWatcherInstance: import("node:fs").FSWatcher | undefined;
}

/**
 * 멱등 — 처음 호출 시 watcher를 띄우고, 이후 호출은 noop.
 * SSE 라우트에서 첫 요청이 들어올 때 호출.
 */
export async function ensureWatcher(): Promise<void> {
  if (globalThis.__sessionWatcherStarted) return;
  globalThis.__sessionWatcherStarted = true;
  // 혹시 이전 모듈 인스턴스가 남긴 watcher가 있으면 닫는다 (HMR 누적 방어).
  if (globalThis.__sessionWatcherInstance) {
    try {
      globalThis.__sessionWatcherInstance.close();
    } catch {
      // 이미 닫혀 있어도 무시.
    }
    globalThis.__sessionWatcherInstance = undefined;
  }
  await initOffsets();
  await startWatch();
}

/**
 * 현재 jsonl 파일들의 길이를 lastOffset으로 미리 채운다.
 * 이미 기록된 과거 이벤트를 토스트로 다시 띄우지 않기 위함.
 *
 * 동시에 subjectCache를 *워밍*한다 — 과거 TaskCreate/TaskUpdate에서 subject만 추출.
 * 이렇게 안 하면 watcher가 시작된 후 들어오는 TaskUpdate에 제목이 비어 있음
 * (input에 status만 있을 때 캐시가 비어 fallback이 동작하지 않음).
 */
async function initOffsets(): Promise<void> {
  const root = path.join(projectRoot(), "projects");
  const files = await listJsonl(root).catch(() => [] as string[]);
  await Promise.all(files.map(warmFile));
}

/** 파일 하나의 lastOffset 기록 + subjectCache 워밍. 실패는 조용히 무시. */
async function warmFile(filePath: string): Promise<void> {
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return;
  }
  offsetByPath.set(filePath, stat.size);

  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return;
  }
  const sessionId = path.basename(filePath, ".jsonl");
  // warmFile 한정의 보류 버퍼 — 라인 순회 동안만 쓰이고 함수 끝나면 버린다.
  const localPending = new Map<string, string | undefined>();
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    // tool_result로 진짜 taskId 회수 — subjectCache 키를 진짜 id로 박는다.
    const resolved = extractTaskResultId(obj);
    if (resolved) {
      const subject = localPending.get(resolved.toolUseId);
      if (subject !== undefined) {
        if (subject) {
          subjectCache.set(`${sessionId}:${resolved.taskId}`, subject);
        }
        localPending.delete(resolved.toolUseId);
      }
    }
    walkToolUses(obj, (name, input, toolUseId) => {
      if (name === "TaskCreate") {
        const subject = stringField(input, "subject");
        if (toolUseId) localPending.set(toolUseId, subject);
      } else if (name === "TaskUpdate") {
        const taskId = stringField(input, "taskId");
        const subject = stringField(input, "subject");
        if (subject && taskId) {
          subjectCache.set(`${sessionId}:${taskId}`, subject);
        }
      } else if (name === "TodoWrite") {
        // 마지막 TodoWrite의 todos를 스냅샷으로 두어 watcher 재시작 후 첫 호출이
        // 모든 기존 항목을 새로 추가된 것처럼 emit하지 않도록 한다.
        const todosRaw = (input as Record<string, unknown>)?.todos;
        if (!Array.isArray(todosRaw)) return;
        const snap = new Map<string, string>();
        for (const item of todosRaw) {
          if (!item || typeof item !== "object") continue;
          const it = item as Record<string, unknown>;
          const content = typeof it.content === "string" ? it.content : "";
          const status = typeof it.status === "string" ? it.status : "pending";
          if (content) snap.set(content, status);
        }
        todoSnapshotBySession.set(sessionId, snap);
      }
    });
  }
}

/**
 * 메인 세션 jsonl만 추적 대상. 서브에이전트(`<sessionId>/subagents/agent-*.jsonl`)는
 * read-time bundling으로 처리되므로 watcher가 잡으면 안 된다 — 알림 sessionId가
 * `agent-<id>`로 망가져 라우팅이 깨짐 (예: /sessions/agent-xxx?tab=tasks).
 */
function isMainSessionJsonl(absPath: string): boolean {
  if (!absPath.endsWith(".jsonl")) return false;
  // path separator는 OS에 따라 다르지만 macOS/Linux 한정이라 '/'로 충분.
  return !absPath.includes("/subagents/");
}

/** 디렉터리를 재귀 탐색해 메인 세션 *.jsonl 파일 절대 경로를 모은다 (서브에이전트 제외). */
async function listJsonl(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return;
    }
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        // subagents 디렉터리는 통째로 skip (자식까지).
        if (ent.name === "subagents") continue;
        await walk(p);
      } else if (ent.isFile() && isMainSessionJsonl(p)) {
        out.push(p);
      }
    }
  }
  await walk(root);
  return out;
}

/**
 * fs.watch로 변경 감지. macOS는 recursive 옵션 지원.
 * Linux는 recursive 미지원 → 모든 하위 디렉터리에 별도 watch가 필요하지만
 * 이 도구의 1차 타깃이 macOS 로컬이라 단순화.
 */
async function startWatch(): Promise<void> {
  const root = path.join(projectRoot(), "projects");
  await fs.mkdir(root, { recursive: true }).catch(() => {});
  // dynamic import로 Node 의존성을 server bundle에만 둔다.
  const fsSync = await import("node:fs");
  try {
    const watcher = fsSync.watch(
      root,
      { recursive: true, persistent: false },
      (_eventType, filename) => {
        if (!filename) return;
        const abs = path.join(root, filename);
        if (!isMainSessionJsonl(abs)) return;
        void scheduleRead(abs);
      },
    );
    // HMR 시 이전 인스턴스를 close할 수 있도록 globalThis에 보관.
    globalThis.__sessionWatcherInstance = watcher;
  } catch {
    // watch 실패해도 앱 자체는 계속 동작. (드물게 권한/경로 문제)
  }
}

/**
 * 같은 파일에 대해 readNew가 동시에 도는 race를 막는다.
 * 직전 readNew Promise가 살아있으면 그 뒤에 chain해 순차 실행.
 */
function scheduleRead(filePath: string): Promise<void> {
  const prev = readChainByPath.get(filePath) ?? Promise.resolve();
  const next = prev
    .catch(() => {
      // 직전 read의 에러는 다음 read 진행에 영향 주지 않는다.
    })
    .then(() => readNew(filePath));
  readChainByPath.set(filePath, next);
  // 체인이 길어지지 않도록 끝나면 정리.
  next.finally(() => {
    if (readChainByPath.get(filePath) === next) {
      readChainByPath.delete(filePath);
    }
  });
  return next;
}

/**
 * 변경된 파일에서 lastOffset 이후 새 바이트만 읽어 line 단위로 파싱.
 * 새 TaskCreate/TaskUpdate 호출만 알림으로 emit.
 *
 * 라인 정합성: 부분 read로 끝부분에 미완성 라인이 남으면 partialByPath에 보관.
 * 다음 read에서 그 tail을 prepend → 잘린 라인 없이 한 줄도 빠지지 않게 처리.
 */
async function readNew(filePath: string): Promise<void> {
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(filePath);
  } catch {
    offsetByPath.delete(filePath);
    return;
  }
  const prevOffset = offsetByPath.get(filePath) ?? 0;
  if (stat.size === prevOffset) return;
  // 파일이 줄어들었으면(rotate 등) 처음부터 다시.
  const offset = stat.size < prevOffset ? 0 : prevOffset;
  const length = stat.size - offset;
  if (length <= 0) {
    offsetByPath.set(filePath, stat.size);
    return;
  }

  let buf: Buffer;
  try {
    const handle = await fs.open(filePath, "r");
    try {
      buf = Buffer.alloc(length);
      await handle.read(buf, 0, length, offset);
    } finally {
      await handle.close();
    }
  } catch {
    return;
  }
  offsetByPath.set(filePath, stat.size);

  const sessionId = path.basename(filePath, ".jsonl");
  // 직전 read의 미완성 tail과 join — 라인이 두 read에 걸쳐있어도 정확히 복원된다.
  const stash = offset === 0 ? "" : (partialByPath.get(filePath) ?? "");
  const text = stash + buf.toString("utf8");
  // 마지막 '\n' 이후는 미완성일 수 있으니 별도 보관, 다음 read에서 prepend.
  const lastNl = text.lastIndexOf("\n");
  const completeText = lastNl >= 0 ? text.slice(0, lastNl) : "";
  partialByPath.set(filePath, lastNl >= 0 ? text.slice(lastNl + 1) : text);

  const lines = completeText.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = extractTimestamp(obj);
    // tool_result로 진짜 taskId 회수 → 보류 TaskCreate를 emit.
    const resolved = extractTaskResultId(obj);
    if (resolved) {
      const pendingKey = `${sessionId}:${resolved.toolUseId}`;
      const pending = pendingCreate.get(pendingKey);
      if (pending) {
        if (pending.subject) {
          subjectCache.set(`${sessionId}:${resolved.taskId}`, pending.subject);
        }
        sessionTaskEvents.emit("event", {
          kind: "create",
          sessionId,
          filePath,
          taskId: resolved.taskId,
          status: "pending",
          subject: pending.subject,
          ts: pending.ts,
        } satisfies SessionTaskNotification);
        pendingCreate.delete(pendingKey);
      }
    }
    walkToolUses(obj, (name, input, toolUseId) => {
      if (name === "TaskCreate") {
        // 진짜 taskId는 같은/후속 라인의 tool_result에서 옴. 보류 등록만 한다.
        const subject = stringField(input, "subject");
        if (toolUseId) {
          pendingCreate.set(`${sessionId}:${toolUseId}`, { subject, ts });
        }
      } else if (name === "TaskUpdate") {
        const taskId = stringField(input, "taskId") ?? "";
        const status = stringField(input, "status");
        const inputSubject = stringField(input, "subject");
        const cacheKey = `${sessionId}:${taskId}`;
        if (inputSubject && taskId) subjectCache.set(cacheKey, inputSubject);
        const subject = inputSubject ?? subjectCache.get(cacheKey);
        const valid =
          status === "pending" ||
          status === "in_progress" ||
          status === "completed" ||
          status === "deleted";
        sessionTaskEvents.emit("event", {
          kind: "update",
          sessionId,
          filePath,
          taskId,
          status: valid ? status : undefined,
          subject,
          ts,
        } satisfies SessionTaskNotification);
      } else if (name === "TodoWrite") {
        // TodoWrite는 todos 배열을 *통째로* 다시 쓴다. content를 안정 키로 직전 스냅샷과 diff:
        //   - 새 content → kind=create
        //   - 같은 content + 상태 변경 → kind=update
        //   - 사라진 content → kind=update with status=deleted
        const todosRaw = (input as Record<string, unknown>)?.todos;
        if (!Array.isArray(todosRaw)) return;
        const next = new Map<string, string>();
        for (const item of todosRaw) {
          if (!item || typeof item !== "object") continue;
          const it = item as Record<string, unknown>;
          const content = typeof it.content === "string" ? it.content : "";
          const status = typeof it.status === "string" ? it.status : "pending";
          if (!content) continue;
          next.set(content, status);
        }
        // TodoWrite는 stable id가 없어 content를 그대로 url의 taskId로 쓰면 길고 못생기다.
        // 알림은 subject(=content)로 본문 표시만 하고, href용 taskId는 비워둔다 — 클릭은
        // /sessions/[id]?tab=tasks 까지만 라우팅(특정 카드 highlight는 포기).
        const prev = todoSnapshotBySession.get(sessionId) ?? new Map();
        for (const [content, status] of next) {
          const prevStatus = prev.get(content);
          if (prevStatus === undefined) {
            sessionTaskEvents.emit("event", {
              kind: "create",
              sessionId,
              filePath,
              taskId: "",
              status: validTaskStatus(status),
              subject: content,
              ts,
            } satisfies SessionTaskNotification);
          } else if (prevStatus !== status) {
            sessionTaskEvents.emit("event", {
              kind: "update",
              sessionId,
              filePath,
              taskId: "",
              status: validTaskStatus(status),
              subject: content,
              ts,
            } satisfies SessionTaskNotification);
          }
        }
        for (const [content] of prev) {
          if (!next.has(content)) {
            sessionTaskEvents.emit("event", {
              kind: "update",
              sessionId,
              filePath,
              taskId: "",
              status: "deleted",
              subject: content,
              ts,
            } satisfies SessionTaskNotification);
          }
        }
        todoSnapshotBySession.set(sessionId, next);
      }
    });
  }
}
