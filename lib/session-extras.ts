import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCache } from "./cache";
import { readSessionBundle } from "./sessions";

/** `~/.claude/sessions/<pid>.json` 파일에서 읽어오는 런타임 상태. */
export type RuntimeStatus = {
  /** Claude Code 프로세스 pid. */
  pid: number;
  /** "waiting" / "running" / "dialog open" 등. 표시는 그대로. */
  status: string;
  /** 대기 중인 이유 (예: "user input"). */
  waitingFor?: string;
  /** Claude Code 버전 문자열. */
  version?: string;
  /** "interactive" / "print" 등. */
  kind?: string;
  /** 시작 시각 (epoch ms). */
  startedAt?: number;
  /** 마지막 업데이트 시각 (epoch ms). */
  updatedAt?: number;
};

/** 세션이 편집(Edit/Write/MultiEdit/NotebookEdit)한 파일 한 줄. */
export type EditedFile = {
  /** 절대 경로. */
  path: string;
  /** 호출 횟수 (메인 + 서브에이전트 합산). */
  count: number;
  /** 서브에이전트에서 일어난 호출 수. count 중 일부 또는 전부일 수 있음. */
  sidechainCount: number;
  /** 첫 호출 시각 (epoch ms). */
  firstAt: number;
  /** 마지막 호출 시각 (epoch ms). */
  lastAt: number;
};

/** `~/.claude/history.jsonl`에서 추출한 사용자 프롬프트 한 줄. */
export type UserPrompt = {
  /** 사용자가 입력한 텍스트. */
  display: string;
  /** epoch ms. */
  timestamp: number;
};

/** 세션 jsonl에서 뽑아낸 대화 한 턴. */
export type ConversationTurn = {
  /** 화자. */
  role: "user" | "assistant";
  /** 표시할 텍스트. assistant는 모든 text 블록을 \n\n으로 이어붙임. */
  text: string;
  /** epoch ms. 정렬에 사용. */
  timestamp: number;
  /** 해당 턴의 도구 호출 목록 (assistant만). 라벨은 tool 이름. */
  toolCalls?: { name: string; filePath?: string }[];
  /** 서브에이전트(Task 도구)에서 일어난 턴이면 true. UI에서 들여쓰기/배지로 구분. */
  sidechain: boolean;
};

/**
 * `~/.claude/sessions/*.json` 파일들을 한 번 훑어 sessionId → RuntimeStatus 맵을 만든다.
 * 사용자가 동시에 여러 세션을 띄울 수 있어 모든 파일을 읽고 sessionId 필드로 그룹화한다.
 *
 * stale 파일(프로세스 죽었지만 json 남은 경우)은 자동으로 제외 — `process.kill(pid, 0)`으로 ping해
 * 살아있는 pid만 결과에 포함한다. 그래야 UI의 "활성/실행 중" 표시가 실제 프로세스 상태와 일치한다.
 */
// 캐시: ~/.claude/sessions 디렉토리 mtime이 같으면 재스캔 없이 반환.
// 새 세션이 뜨거나 기존 파일이 갱신되면 dir mtime이 바뀌므로 안전하게 무효화된다.
const runtimeStatusCache = createCache<
  "default",
  { dirMtimeMs: number; result: Map<string, RuntimeStatus> }
>("runtime-statuses");

/**
 * `~/.claude/sessions/*.json`을 한 번 훑어 sessionId → RuntimeStatus 맵을 만든다.
 * 죽은 pid는 자동으로 제외된다 (UI의 "활성" 표시와 실제 프로세스 상태를 일치시키기 위함).
 * 디렉토리 mtime 캐시로 변경 없으면 재스캔하지 않는다.
 */
export async function readAllRuntimeStatuses(): Promise<Map<string, RuntimeStatus>> {
  const dir = path.join(os.homedir(), ".claude", "sessions");
  let dirStat;
  try {
    dirStat = await fs.stat(dir);
  } catch {
    runtimeStatusCache.delete("default");
    return new Map();
  }
  const cached = runtimeStatusCache.get("default");
  if (cached && cached.dirMtimeMs === dirStat.mtimeMs) {
    return cached.result;
  }
  const out = new Map<string, RuntimeStatus>();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return out;
  }
  // 모든 파일을 동시에 읽고 파싱한다 — 디스크 IO를 직렬에서 병렬로.
  const parsed = await Promise.all(
    entries
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        try {
          const raw = await fs.readFile(path.join(dir, name), "utf8");
          return JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return null;
        }
      }),
  );
  for (const obj of parsed) {
    if (!obj || typeof obj.sessionId !== "string") continue;
    const pid = typeof obj.pid === "number" ? obj.pid : 0;
    if (pid <= 0 || !isPidAlive(pid)) continue;
    out.set(obj.sessionId, {
      pid,
      status: typeof obj.status === "string" ? obj.status : "unknown",
      waitingFor:
        typeof obj.waitingFor === "string" ? obj.waitingFor : undefined,
      version: typeof obj.version === "string" ? obj.version : undefined,
      kind: typeof obj.kind === "string" ? obj.kind : undefined,
      startedAt:
        typeof obj.startedAt === "number" ? obj.startedAt : undefined,
      updatedAt:
        typeof obj.updatedAt === "number" ? obj.updatedAt : undefined,
    });
  }
  runtimeStatusCache.set("default", { dirMtimeMs: dirStat.mtimeMs, result: out });
  return out;
}

/**
 * sessionId로 매칭되는 runtime 파일의 절대 경로를 찾는다.
 * 없으면 null. 삭제 후 cleanup용.
 */
export async function findRuntimeFileForSession(
  sessionId: string,
): Promise<string | null> {
  const dir = path.join(os.homedir(), ".claude", "sessions");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(dir, name);
    try {
      const raw = await fs.readFile(file, "utf8");
      const obj = JSON.parse(raw);
      if (obj?.sessionId === sessionId) return file;
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * 주어진 pid가 현재 살아있는지 확인. POSIX `kill(pid, 0)` 트릭.
 * - 신호 0은 실제 신호를 보내지 않고 권한/존재만 검사한다.
 * - 자기 사용자 권한 밖 프로세스도 ESRCH 대신 EPERM으로 throw하지만, 그 경우는 "존재함"으로 간주.
 */
export function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // EPERM: 권한 없지만 프로세스는 존재 → 살아있다고 본다.
    return code === "EPERM";
  }
}

/**
 * 세션 jsonl을 한 번 스캔해 편집(mutation) 도구 호출만 골라 파일별로 집계.
 * 읽기(Read)·검색(Grep) 등은 카운트하지 않는다 — "이 세션이 무엇을 바꿨나"가 목적.
 */
// 메인 + 서브에이전트 본문을 합친 fingerprint로 캐시.
const editedFilesCache = createCache<
  string,
  { fingerprint: string; result: EditedFile[] }
>("parse-edited-files");

/**
 * 세션 jsonl을 1회 스캔해 mutation 도구가 만진 파일별 호출 수/시간을 집계.
 * 메인 + 서브에이전트(`<sessionId>/subagents/agent-*.jsonl`)을 모두 본다.
 * 결과는 lastAt 내림차순. fingerprint 캐시로 중복 파싱 회피.
 */
export async function parseEditedFiles(jsonlPath: string): Promise<EditedFile[]> {
  const bundle = await readSessionBundle(jsonlPath);
  if (!bundle) return [];
  const cached = editedFilesCache.get(jsonlPath);
  if (cached && cached.fingerprint === bundle.fingerprint) {
    return cached.result;
  }
  const map = new Map<string, EditedFile>();
  const raw = bundle.body;
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = extractTimestamp(obj);
    const isSidechain =
      typeof obj === "object" &&
      obj !== null &&
      (obj as Record<string, unknown>).isSidechain === true;
    walk(obj, (toolName, input) => {
      if (!isMutatingTool(toolName)) return;
      const filePath = typeof input?.file_path === "string" ? input.file_path : null;
      if (!filePath) return;
      const prev = map.get(filePath);
      if (!prev) {
        map.set(filePath, {
          path: filePath,
          count: 1,
          sidechainCount: isSidechain ? 1 : 0,
          firstAt: ts,
          lastAt: ts,
        });
      } else {
        prev.count += 1;
        if (isSidechain) prev.sidechainCount += 1;
        if (ts < prev.firstAt) prev.firstAt = ts;
        if (ts > prev.lastAt) prev.lastAt = ts;
      }
    });
  }
  const result = Array.from(map.values()).sort((a, b) => b.lastAt - a.lastAt);
  editedFilesCache.set(jsonlPath, { fingerprint: bundle.fingerprint, result });
  return result;
}

/**
 * `~/.claude/history.jsonl`에서 sessionId 일치 항목만 필터해 시간순으로 반환.
 * 큰 파일이 될 수 있어 라인 단위 파싱 후 메모리 안에서 필터링 (수십 MB 가정).
 */
export async function readUserPromptsForSession(
  sessionId: string,
): Promise<UserPrompt[]> {
  const file = path.join(os.homedir(), ".claude", "history.jsonl");
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return [];
  }
  const out: UserPrompt[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj?.sessionId !== sessionId) continue;
      if (typeof obj.display !== "string") continue;
      out.push({
        display: obj.display,
        timestamp: typeof obj.timestamp === "number" ? obj.timestamp : 0,
      });
    } catch {
      // 손상 라인은 건너뜀.
    }
  }
  return out.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * 세션 jsonl을 한 번 스캔해 사용자/어시스턴트 텍스트 턴을 추출한다.
 * tool_result echo, thinking, tool_use는 본문 텍스트로 포함하지 않는다.
 * 단, assistant 턴에는 같이 일어난 tool_use를 toolCalls 배열로 첨부.
 */
// 메인 + 서브에이전트 본문을 합친 fingerprint로 캐시.
const conversationCache = createCache<
  string,
  { fingerprint: string; result: ConversationTurn[] }
>("parse-conversation");

/**
 * 세션 jsonl에서 사용자/어시스턴트 텍스트 턴을 시간 역순(최신이 위)으로 추출.
 * 메인 + 서브에이전트(`<sessionId>/subagents/agent-*.jsonl`)을 모두 본다.
 * tool_result echo·thinking·tool_use 본문은 텍스트로 포함하지 않는다.
 * assistant 턴은 같이 일어난 tool_use를 toolCalls 배열로 첨부.
 */
export async function parseConversation(
  jsonlPath: string,
): Promise<ConversationTurn[]> {
  const bundle = await readSessionBundle(jsonlPath);
  if (!bundle) return [];
  const cached = conversationCache.get(jsonlPath);
  if (cached && cached.fingerprint === bundle.fingerprint) {
    return cached.result;
  }
  const raw = bundle.body;
  const turns: ConversationTurn[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = obj.type;
    if (type !== "user" && type !== "assistant") continue;
    const msg = obj.message as Record<string, unknown> | undefined;
    if (!msg) continue;
    const ts = extractTimestamp(obj);
    const sidechain = obj.isSidechain === true;
    const content = msg.content;

    if (type === "user") {
      // 메인 흐름의 user는 보통 content가 문자열인 진짜 입력.
      if (typeof content === "string" && content.trim()) {
        turns.push({ role: "user", text: content, timestamp: ts, sidechain });
        continue;
      }
      // 배열인 경우: 메인이면 대부분 tool_result echo라 skip,
      // 서브에이전트이면 서브에이전트의 첫 입력 프롬프트가 텍스트 블록으로 올 때가 있어 추출 시도.
      if (sidechain && Array.isArray(content)) {
        const texts: string[] = [];
        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          const b = block as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string") texts.push(b.text);
        }
        if (texts.length > 0) {
          turns.push({
            role: "user",
            text: texts.join("\n\n"),
            timestamp: ts,
            sidechain,
          });
        }
      }
      continue;
    }

    // assistant: text 블록 모두 합치고, tool_use는 별도 배열로.
    if (!Array.isArray(content)) continue;
    const texts: string[] = [];
    const toolCalls: { name: string; filePath?: string }[] = [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") {
        texts.push(b.text);
      } else if (b.type === "tool_use" && typeof b.name === "string") {
        const input =
          b.input && typeof b.input === "object"
            ? (b.input as Record<string, unknown>)
            : undefined;
        toolCalls.push({
          name: b.name,
          filePath:
            typeof input?.file_path === "string"
              ? input.file_path
              : typeof input?.notebook_path === "string"
                ? (input.notebook_path as string)
                : undefined,
        });
      }
    }
    if (texts.length === 0 && toolCalls.length === 0) continue;
    turns.push({
      role: "assistant",
      text: texts.join("\n\n"),
      timestamp: ts,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      sidechain,
    });
  }
  // 최신 턴이 위로 오도록 역순 반환.
  // ts DESC 정렬 — 메인 + 서브에이전트 본문이 파일 순서로 합쳐져 들어와서 line 순서가 시간순이 아닐 수 있다.
  const result = turns.slice().sort((a, b) => b.timestamp - a.timestamp);
  conversationCache.set(jsonlPath, { fingerprint: bundle.fingerprint, result });
  return result;
}

const MUTATING_TOOLS = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
]);

function isMutatingTool(name: string): boolean {
  return MUTATING_TOOLS.has(name);
}

/** jsonl 한 라인의 다양한 위치에 있는 timestamp 후보를 가져온다. */
function extractTimestamp(obj: unknown): number {
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
 * 라인 안에 임베드된 모든 tool_use를 찾아 콜백한다.
 * Claude Code jsonl은 tool_use가 message.content 배열 안에 들어있는 경우가 많아 재귀 탐색.
 */
function walk(
  obj: unknown,
  visit: (toolName: string, input: Record<string, unknown> | undefined) => void,
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
      for (const v of value) walk(v, visit);
    } else if (value && typeof value === "object") {
      walk(value, visit);
    }
  }
}
