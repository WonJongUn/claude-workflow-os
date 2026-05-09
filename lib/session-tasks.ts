import fs from "node:fs/promises";
import path from "node:path";
import { createCache } from "@/lib/cache";
import { projectRoot } from "@/lib/paths";
import { readSessionBundle } from "@/lib/sessions";

/**
 * 세션 jsonl을 처음부터 재생해 TaskCreate/TaskUpdate/TodoWrite 도구 호출 순서로
 * 태스크 상태를 복원한다. claude 본체가 완료/삭제 시 .json 파일을 지우므로,
 * 활성 태스크만 보여주는 라이브 뷰와 달리 이력 뷰는 이 함수로만 얻을 수 있다.
 *
 * 단, 세션 로그가 256KB 잘림 등으로 일부 누락되면 그만큼 부정확하다.
 */
/**
 * 단일 태스크 이벤트. 리플레이 UI는 이 배열을 한 칸씩 적용하며 애니메이션을 만든다.
 * `snapshot`은 이 이벤트가 적용된 *직후* 해당 태스크의 전체 상태(불변 사본).
 */
export type SessionTaskEvent = {
  /** jsonl line의 timestamp (epoch ms). 0이면 알 수 없음. */
  ts: number;
  /** 이벤트 종류. */
  kind: "create" | "update";
  /** 영향 받은 태스크 id. */
  taskId: string;
  /** 적용 직후 태스크 스냅샷 (불변). */
  snapshot: SessionTask;
};

/**
 * 세션 jsonl을 라인 순서대로 재생해 (이벤트 배열, 최종 상태)를 함께 반환한다.
 * 이벤트 배열은 리플레이 UI 전용 — 각 항목은 시점별 스냅샷이라 시간 역행 없이 평가 가능.
 */
// 세션 fingerprint(메인+서브에이전트의 (path,mtime,size) 직렬화) → 결과.
// 어느 파일이든 변경되면 fingerprint가 달라져 자동 무효화.
const replayCache = createCache<
  string,
  {
    fingerprint: string;
    result: { events: SessionTaskEvent[]; finalTasks: SessionTask[] };
  }
>("replay-task-timeline");

/**
 * 세션 jsonl을 라인 순서대로 재생해 `(이벤트 배열, 최종 상태)`를 함께 반환한다.
 * 메인 + 서브에이전트 jsonl을 모두 읽어 합친 본문을 처리한다.
 */
export async function replaySessionTaskTimeline(
  jsonlPath: string,
): Promise<{ events: SessionTaskEvent[]; finalTasks: SessionTask[] }> {
  const bundle = await readSessionBundle(jsonlPath);
  if (!bundle) return { events: [], finalTasks: [] };
  const cached = replayCache.get(jsonlPath);
  if (cached && cached.fingerprint === bundle.fingerprint) {
    return cached.result;
  }
  const raw = bundle.body;
  const created: SessionTask[] = [];
  const byId = new Map<string, SessionTask>();
  const events: SessionTaskEvent[] = [];
  let lastTodoWrite: SessionTask[] | null = null;

  for (const line of raw.split("\n")) {
    if (!line) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    // 서브에이전트의 TaskCreate/TaskUpdate는 그 서브에이전트의 *내부* 태스크 관리라
    // 메인 세션의 태스크 목록과 섞이면 id 카운터 충돌이 생긴다. Tasks 탭은 메인 흐름만 보여준다.
    if ((obj as { isSidechain?: boolean }).isSidechain === true) continue;
    const ts = extractTimestamp(obj);
    walkToolUses(obj, (name, input) => {
      if (name === "TaskCreate") {
        const id = String(created.length + 1);
        const task: SessionTask = {
          id,
          subject: stringField(input, "subject") ?? "(untitled)",
          description: stringField(input, "description"),
          activeForm: stringField(input, "activeForm"),
          status: "pending",
        };
        created.push(task);
        byId.set(id, task);
        events.push({ ts, kind: "create", taskId: id, snapshot: { ...task } });
      } else if (name === "TaskUpdate") {
        const taskId = stringField(input, "taskId");
        if (!taskId) return;
        const t = byId.get(taskId);
        if (!t) return;
        const status = stringField(input, "status");
        if (
          status === "pending" ||
          status === "in_progress" ||
          status === "completed" ||
          status === "deleted"
        ) {
          t.status = status;
        }
        const subject = stringField(input, "subject");
        if (subject) t.subject = subject;
        const description = stringField(input, "description");
        if (description) t.description = description;
        const activeForm = stringField(input, "activeForm");
        if (activeForm) t.activeForm = activeForm;
        const owner = stringField(input, "owner");
        if (owner) t.owner = owner;
        const addBlocks = stringArrayField(input, "addBlocks");
        if (addBlocks) t.blocks = mergeUnique(t.blocks, addBlocks);
        const addBlockedBy = stringArrayField(input, "addBlockedBy");
        if (addBlockedBy) t.blockedBy = mergeUnique(t.blockedBy, addBlockedBy);
        events.push({ ts, kind: "update", taskId, snapshot: { ...t } });
      } else if (name === "TodoWrite") {
        const todos = input?.todos;
        if (!Array.isArray(todos)) return;
        lastTodoWrite = todos.map((it, idx): SessionTask => {
          const item = it as {
            content?: string;
            status?: SessionTask["status"];
            activeForm?: string;
          };
          return {
            id: String(idx + 1),
            subject: item.content ?? "(untitled)",
            activeForm: item.activeForm,
            status: item.status ?? "pending",
          };
        });
      }
    });
  }

  const finalTasks = created.length > 0 ? created : (lastTodoWrite ?? []);
  const result = { events, finalTasks };
  replayCache.set(jsonlPath, { fingerprint: bundle.fingerprint, result });
  return result;
}

/**
 * jsonl 라인 객체에서 timestamp 필드를 epoch ms로 추출.
 * ISO 문자열·숫자 모두 허용. 누락이거나 파싱 실패 시 0.
 */
export function extractTimestamp(obj: unknown): number {
  if (!obj || typeof obj !== "object") return 0;
  const o = obj as Record<string, unknown>;
  if (typeof o.timestamp === "string") {
    const t = Date.parse(o.timestamp);
    if (!Number.isNaN(t)) return t;
  }
  if (typeof o.timestamp === "number") return o.timestamp;
  return 0;
}

/**
 * 도구 input 객체에서 문자열 필드를 안전하게 꺼낸다.
 * 누락/타입 불일치 시 undefined — 호출 측에서 분기하기 좋게.
 */
export function stringField(
  input: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!input) return undefined;
  const v = input[key];
  return typeof v === "string" ? v : undefined;
}

function stringArrayField(
  input: Record<string, unknown> | undefined,
  key: string,
): string[] | undefined {
  if (!input) return undefined;
  const v = input[key];
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length > 0 ? out : undefined;
}

function mergeUnique(
  base: string[] | undefined,
  add: string[],
): string[] {
  const set = new Set<string>(base ?? []);
  for (const x of add) set.add(x);
  return Array.from(set);
}

/**
 * jsonl 라인 객체를 재귀 순회하며 모든 `type: "tool_use"` 항목에 대해
 * `(name, input)`을 호출한다. assistant 메시지 안 nested content를 모두 훑는다.
 */
export function walkToolUses(
  obj: unknown,
  visit: (
    name: string,
    input: Record<string, unknown> | undefined,
  ) => void,
): void {
  if (!obj || typeof obj !== "object") return;
  const o = obj as Record<string, unknown>;
  if (o.type === "tool_use" && typeof o.name === "string") {
    const input =
      o.input && typeof o.input === "object"
        ? (o.input as Record<string, unknown>)
        : undefined;
    visit(o.name, input);
  }
  for (const value of Object.values(o)) {
    if (Array.isArray(value)) {
      for (const v of value) walkToolUses(v, visit);
    } else if (value && typeof value === "object") {
      walkToolUses(value, visit);
    }
  }
}

/**
 * Claude Code 세션이 진행 중에 관리하는 단일 태스크.
 * `~/.claude/tasks/<sessionId>/<id>.json` 한 파일이 한 태스크.
 */
export type SessionTask = {
  /** 태스크 id. 세션 안에서 1부터 증가. */
  id: string;
  /** 표시되는 짧은 제목(명령형). */
  subject: string;
  /** 무엇을 해야 하는지 상세 설명. */
  description?: string;
  /** in_progress 동안 스피너 옆에 표시되는 진행형 라벨. */
  activeForm?: string;
  /** 진행 상태. `deleted`는 jsonl 재생 이력에서만 등장(라이브 파일로는 존재하지 않음). */
  status: "pending" | "in_progress" | "completed" | "deleted";
  /** 이 태스크가 끝나야 시작 가능한 태스크 id 들. */
  blocks?: string[];
  /** 이 태스크 시작 전에 끝나야 하는 태스크 id 들. */
  blockedBy?: string[];
  /** 담당 에이전트(있으면). */
  owner?: string;
};

/**
 * Claude Code 세션의 현재 태스크 목록을 반환한다.
 *
 * 우선순위:
 * 1. 신규 TaskCreate 도구 — `~/.claude/tasks/<sessionId>/*.json` (한 파일 = 한 태스크)
 * 2. 레거시 TodoWrite 도구 — `~/.claude/todos/<sessionId>-agent-<sessionId>.json` (배열 한 파일)
 *
 * 둘 다 비어 있으면 빈 배열. 외부 호출은 모두 실패해도 빈 배열을 돌려준다 (도메인 데이터로 신뢰).
 */
export async function readSessionTasks(
  sessionId: string,
): Promise<SessionTask[]> {
  const fromTasks = await readFromTasksDir(sessionId);
  if (fromTasks.length > 0) return fromTasks;
  return await readFromTodosFile(sessionId);
}

async function readFromTasksDir(sessionId: string): Promise<SessionTask[]> {
  const dir = path.join(projectRoot(), "tasks", sessionId);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const jsonFiles = entries.filter(
    (name) => !name.startsWith(".") && name.endsWith(".json"),
  );
  // 모든 task 파일을 동시에 읽어 IO 직렬 → 병렬.
  const tasks = await Promise.all(
    jsonFiles.map(async (name) => {
      try {
        const raw = await fs.readFile(path.join(dir, name), "utf-8");
        return JSON.parse(raw) as SessionTask;
      } catch {
        return null;
      }
    }),
  );
  return tasks
    .filter((t): t is SessionTask => t !== null)
    .sort(byNumericId);
}

async function readFromTodosFile(sessionId: string): Promise<SessionTask[]> {
  const file = path.join(
    projectRoot(),
    "todos",
    `${sessionId}-agent-${sessionId}.json`,
  );
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch {
    return [];
  }
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((it, idx): SessionTask => {
    const item = it as {
      content?: string;
      status?: SessionTask["status"];
      activeForm?: string;
    };
    return {
      id: String(idx + 1),
      subject: item.content ?? "(untitled)",
      activeForm: item.activeForm,
      status: item.status ?? "pending",
    };
  });
}

function byNumericId(a: SessionTask, b: SessionTask): number {
  const an = Number(a.id);
  const bn = Number(b.id);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return a.id.localeCompare(b.id);
}
