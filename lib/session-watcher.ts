import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createCache } from "@/lib/cache";
import { projectRoot } from "@/lib/paths";
import {
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
 */
export const sessionTaskEvents = new EventEmitter();
sessionTaskEvents.setMaxListeners(50);

/** 파일별 마지막으로 읽은 byte offset. 다음 변경 시 그 지점부터만 read. */
const offsetByPath = new Map<string, number>();
/**
 * 세션 + taskId별 마지막으로 본 subject.
 * TaskUpdate input에는 보통 status만 들어있어 알림에 제목이 비어 시인성이 떨어진다.
 * TaskCreate가 subject를 명시할 때 캐시해두고, 다음 update에 빈 subject면 채워준다.
 * 키 형식: `${sessionId}:${taskId}`.
 *
 * 다른 이 모듈의 Map들(`offsetByPath`, `createCounter`, `partialByPath`, `readChainByPath`)은
 * 캐시가 아니라 watcher의 *상태 머신* (offset/카운터/스트림 버퍼/in-flight queue)이라 NamedCache로 옮기지 않는다.
 */
const subjectCache = createCache<string, string>("session-watcher.subject");
/**
 * 세션별 누적 TaskCreate 카운터.
 * jsonl의 TaskCreate tool_use input에는 taskId 필드가 없고(결과에서 부여됨),
 * `replaySessionTaskTimeline`도 동일하게 created.length + 1을 id로 사용한다.
 * 이 카운터를 watcher에서 같은 규칙으로 유지해 TaskUpdate의 taskId와 매칭한다.
 */
const createCounter = new Map<string, number>();
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

/** watcher가 한 번 시작됐는지. */
let started = false;

/**
 * 멱등 — 처음 호출 시 watcher를 띄우고, 이후 호출은 noop.
 * SSE 라우트에서 첫 요청이 들어올 때 호출.
 */
export async function ensureWatcher(): Promise<void> {
  if (started) return;
  started = true;
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
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    walkToolUses(obj, (name, input) => {
      if (name === "TaskCreate") {
        const next = (createCounter.get(sessionId) ?? 0) + 1;
        createCounter.set(sessionId, next);
        const subject = stringField(input, "subject");
        if (subject) subjectCache.set(`${sessionId}:${next}`, subject);
      } else if (name === "TaskUpdate") {
        const taskId = stringField(input, "taskId");
        const subject = stringField(input, "subject");
        if (subject && taskId) {
          subjectCache.set(`${sessionId}:${taskId}`, subject);
        }
      }
    });
  }
}

/** 디렉터리를 재귀 탐색해 *.jsonl 파일 절대 경로를 모은다. */
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
        await walk(p);
      } else if (ent.isFile() && ent.name.endsWith(".jsonl")) {
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
    fsSync.watch(
      root,
      { recursive: true, persistent: false },
      (_eventType, filename) => {
        if (!filename) return;
        if (!filename.endsWith(".jsonl")) return;
        const abs = path.join(root, filename);
        void scheduleRead(abs);
      },
    );
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
    walkToolUses(obj, (name, input) => {
      if (name === "TaskCreate") {
        // jsonl tool_use input에는 taskId가 없고 결과에서 부여됨 — 세션별 순번으로 합성.
        const next = (createCounter.get(sessionId) ?? 0) + 1;
        createCounter.set(sessionId, next);
        const taskId = String(next);
        const subject = stringField(input, "subject");
        if (subject) subjectCache.set(`${sessionId}:${taskId}`, subject);
        sessionTaskEvents.emit("event", {
          kind: "create",
          sessionId,
          filePath,
          taskId,
          status: "pending",
          subject,
          ts,
        } satisfies SessionTaskNotification);
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
      }
    });
  }
}
