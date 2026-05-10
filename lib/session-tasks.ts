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
  // TodoWrite 슬롯별 재할당 횟수. subject 가 바뀌면 같은 슬롯이라도 새 logical task 로 취급해
  // id 를 분기한다 (1 → 1.2 → 1.3 ...). 그래프에서 한 노드 안에 여러 작업이 섞이는 걸 방지.
  const slotReuse = new Map<number, number>();

  // 본문은 메인 + 서브에이전트 jsonl을 file 순서로 concat한 결과 — 시간순이 아니다(E6).
  // 상태 머신을 정확히 굴리려면 ts 기준 정렬이 필수. 정렬 안 하면 sidechain의 빠른 ts 업데이트가
  // 메인의 늦은 ts 업데이트를 덮어 final state가 틀어진다.
  type Parsed = { obj: unknown; ts: number; isSide: boolean };
  const parsed: Parsed[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    parsed.push({
      obj,
      ts: extractTimestamp(obj),
      isSide: (obj as { isSidechain?: boolean }).isSidechain === true,
    });
  }
  // ts 동률은 file 순서 유지(stable sort).
  parsed.sort((a, b) => a.ts - b.ts);

  // tool_use_id → 아직 진짜 taskId가 도착하지 않은 TaskCreate(보류).
  // 같은 라인 또는 후속 라인의 tool_result(toolUseResult.task.id)로 확정한다.
  // Claude Code 2.1+에서 taskId는 harness 전역 시퀀스라 우리가 1..N으로 합성하면
  // TaskUpdate.input.taskId 와 영원히 어긋난다 (E11).
  const pendingByUseId = new Map<
    string,
    { ts: number; task: SessionTask }
  >();
  let synthCounter = 0;

  for (const { obj, ts, isSide } of parsed) {
    // 1) tool_result에서 진짜 taskId 회수 — 보류된 TaskCreate를 확정.
    const resolved = extractTaskResultId(obj);
    if (resolved) {
      const pending = pendingByUseId.get(resolved.toolUseId);
      if (pending) {
        pending.task.id = resolved.taskId;
        byId.set(resolved.taskId, pending.task);
        events.push({
          ts: pending.ts,
          kind: "create",
          taskId: resolved.taskId,
          snapshot: { ...pending.task },
        });
        pendingByUseId.delete(resolved.toolUseId);
      }
    }
    // 서브에이전트가 메인 흐름과 섞일 때:
    // - TaskCreate: 서브에이전트 내부의 별도 태스크라 메인 카운터와 충돌 → skip
    // - TaskUpdate: TeamCreate처럼 lead와 팀원이 *같은* 공유 태스크 목록을 다루면
    //   완료 처리가 서브에이전트 jsonl에서 일어남. 메인에 이미 등록된 taskId만 받아 동기화.
    walkToolUses(obj, (name, input, toolUseId) => {
      if (isSide && name !== "TaskUpdate") return;
      if (name === "TaskCreate") {
        synthCounter += 1;
        // 진짜 id는 매칭되는 tool_result로 채워질 때까지 보류.
        // tool_use_id가 없는 비상 케이스(구버전?)는 즉시 합성 id로 확정.
        const task: SessionTask = {
          id: String(synthCounter), // placeholder — tool_result 도착 시 진짜 id로 갱신
          subject: stringField(input, "subject") ?? "(untitled)",
          description: stringField(input, "description"),
          activeForm: stringField(input, "activeForm"),
          status: "pending",
        };
        created.push(task);
        if (toolUseId) {
          pendingByUseId.set(toolUseId, { ts, task });
        } else {
          byId.set(task.id, task);
          events.push({
            ts,
            kind: "create",
            taskId: task.id,
            snapshot: { ...task },
          });
        }
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
        // 직전 스냅샷과 인덱스 기준 diff → 그래프용 create/update 이벤트 합성.
        // TodoWrite는 *전체 list 스냅샷* 도구라 자체 이벤트가 없음 → diff로 사후 추출.
        // 슬롯의 subject 가 바뀌면 같은 슬롯에 *새 logical task* 가 들어온 것으로 보고
        // 이전 task 를 deleted 로 닫고 새 id 를 발급한다 (id 형식: "i" → "i.2" → "i.3").
        const prev = lastTodoWrite ?? [];
        const next: SessionTask[] = [];
        for (let i = 0; i < todos.length; i += 1) {
          const item = todos[i] as {
            content?: string;
            status?: SessionTask["status"];
            activeForm?: string;
          };
          const subject = item.content ?? "(untitled)";
          const status = item.status ?? "pending";
          const activeForm = item.activeForm;
          const old = prev[i];
          const sameLogical = old !== undefined && old.subject === subject;
          let id: string;
          if (sameLogical) {
            id = old.id;
          } else {
            if (old) {
              events.push({
                ts,
                kind: "update",
                taskId: old.id,
                snapshot: { ...old, status: "deleted" },
              });
            }
            const reuse = (slotReuse.get(i) ?? 0) + 1;
            slotReuse.set(i, reuse);
            id = reuse === 1 ? String(i + 1) : `${i + 1}.${reuse}`;
          }
          const cur: SessionTask = { id, subject, activeForm, status };
          next.push(cur);
          if (!sameLogical) {
            events.push({ ts, kind: "create", taskId: id, snapshot: { ...cur } });
          } else if (
            old.status !== status ||
            old.activeForm !== activeForm
          ) {
            events.push({ ts, kind: "update", taskId: id, snapshot: { ...cur } });
          }
        }
        // 줄어든 항목은 deleted로 표시 (드물지만 가능).
        for (let i = todos.length; i < prev.length; i += 1) {
          const removed = prev[i];
          events.push({
            ts,
            kind: "update",
            taskId: removed.id,
            snapshot: { ...removed, status: "deleted" },
          });
        }
        lastTodoWrite = next;
      }
    });
  }

  // tool_result가 아직 안 도착한 보류 TaskCreate(스트림 도중 로그)는 placeholder id로 둔 채 emit.
  // 다음 read에서 tool_result가 들어오면 fingerprint가 바뀌어 캐시 갱신 → 진짜 id로 정정된다.
  for (const { ts, task } of pendingByUseId.values()) {
    byId.set(task.id, task);
    events.push({ ts, kind: "create", taskId: task.id, snapshot: { ...task } });
  }

  // events 를 taskId 별 최종 스냅샷으로 fold → "현재 상황" view 가 deleted/completed 까지
  // 모두 보게 한다. lastTodoWrite 만 쓰면 TodoWrite 가 잘라낸 항목이 history 에서 사라짐 (E12).
  const finalById = new Map<string, SessionTask>();
  for (const ev of events) finalById.set(ev.taskId, ev.snapshot);
  const finalTasks =
    finalById.size > 0
      ? Array.from(finalById.values()).sort(byNumericId)
      : created;
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
 * `(name, input, toolUseId)`을 호출한다. assistant 메시지 안 nested content를 모두 훑는다.
 *
 * `toolUseId`는 같은 호출의 tool_result와 매칭에 쓰인다 (예: TaskCreate가 받은
 * 진짜 harness taskId를 envelope.toolUseResult에서 회수할 때).
 */
export function walkToolUses(
  obj: unknown,
  visit: (
    name: string,
    input: Record<string, unknown> | undefined,
    toolUseId: string | undefined,
  ) => void,
): void {
  if (!obj || typeof obj !== "object") return;
  const o = obj as Record<string, unknown>;
  if (o.type === "tool_use" && typeof o.name === "string") {
    const input =
      o.input && typeof o.input === "object"
        ? (o.input as Record<string, unknown>)
        : undefined;
    const toolUseId = typeof o.id === "string" ? o.id : undefined;
    visit(o.name, input, toolUseId);
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
 * tool_result 라인의 envelope에서 `toolUseResult.task.id` 를 회수한다.
 * Claude Code가 TaskCreate에 부여한 *진짜* (harness 전역) taskId.
 *
 * 라인 한 줄에는 보통 한 개의 tool_result만 들어 있다 (보낸 tool_use_id와 1:1).
 * 여러 개가 들어오는 변형이 발견되면 첫 매칭만 반환.
 */
export function extractTaskResultId(
  obj: unknown,
): { toolUseId: string; taskId: string } | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const tur = o.toolUseResult;
  if (!tur || typeof tur !== "object") return null;
  const task = (tur as Record<string, unknown>).task;
  if (!task || typeof task !== "object") return null;
  const id = (task as Record<string, unknown>).id;
  if (typeof id !== "string" || id.length === 0) return null;
  // 같은 라인에서 tool_use_id를 찾는다 (message.content[*].tool_result).
  const toolUseId = findToolResultId(obj);
  if (!toolUseId) return null;
  return { toolUseId, taskId: id };
}

/** 라인 객체를 재귀 순회해 첫 번째 `tool_result` 블록의 `tool_use_id`를 찾는다. */
function findToolResultId(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (
    o.type === "tool_result" &&
    typeof (o as { tool_use_id?: unknown }).tool_use_id === "string"
  ) {
    return (o as { tool_use_id: string }).tool_use_id;
  }
  for (const value of Object.values(o)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        const r = findToolResultId(v);
        if (r) return r;
      }
    } else if (value && typeof value === "object") {
      const r = findToolResultId(value);
      if (r) return r;
    }
  }
  return null;
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
