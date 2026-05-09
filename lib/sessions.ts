import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readAllRuntimeStatuses, type RuntimeStatus } from "./session-extras";

/**
 * Claude Code 세션 한 건. ~/.claude/projects/<encoded>/<id>.jsonl + 런타임 매칭으로 만든다.
 * cwd 매칭의 진실 소스는 encodedDir (decodeForDisplay는 손실 변환).
 */
export type SessionInfo = {
  /** 세션 식별자 (파일명에서 추출). */
  id: string;
  /** Claude Code가 추적하는 원본 작업 디렉토리. 인코딩 한계로 부정확할 수 있어 표시용. */
  cwd: string;
  /** Claude Code가 만든 인코딩된 디렉토리 이름. 매칭의 진실 소스. */
  encodedDir: string;
  /** jsonl 파일 절대 경로. */
  filePath: string;
  /** 마지막 수정 시각 (epoch ms). */
  modifiedAt: number;
  /** mtime이 ACTIVE_WINDOW_MS 이내면 활성. */
  active: boolean;
  /**
   * `~/.claude/sessions/<pid>.json`에서 매칭된 런타임 상태.
   * Claude Code 프로세스가 살아 있을 때만 존재. 종료된 세션은 undefined.
   */
  runtime?: RuntimeStatus;
};

const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

/** `~/.claude/projects` — Claude Code가 세션 jsonl을 저장하는 루트. */
export function projectsDir(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

/**
 * Claude Code의 인코딩 규칙: 절대 경로의 모든 `/`를 `-`로 치환.
 * 경로 자체에 `-`가 있으면 역변환은 모호하므로, 비교는 인코딩된 형태로 한다.
 */
function encodePath(absolute: string): string {
  return path.resolve(absolute).replace(/\//g, "-");
}

/**
 * 인코딩된 디렉토리명을 표시용으로 복원. `-`는 `/`로 치환되며, 원본에 `-`가 있던 경우는 부정확.
 * 매칭 용도가 아닌 UI 표시 전용.
 */
function decodeForDisplay(encoded: string): string {
  return `/${encoded.replace(/^-/, "").replace(/-/g, "/")}`;
}

/**
 * 모든 Claude Code 세션 정보. 최신 mtime 우선.
 */
export async function listAllSessions(): Promise<SessionInfo[]> {
  const root = projectsDir();
  let projectDirs: string[];
  try {
    projectDirs = await fs.readdir(root);
  } catch {
    return [];
  }
  const now = Date.now();
  const runtimeMap = await readAllRuntimeStatuses();
  // 프로젝트 디렉토리들을 병렬로 readdir + 그 안의 jsonl도 병렬로 stat.
  // 직렬이면 N×stat-latency, 병렬이면 max-concurrent로 압축된다.
  const perProject = await Promise.all(
    projectDirs.map(async (encodedDir) => {
      const cwd = decodeForDisplay(encodedDir);
      const dir = path.join(root, encodedDir);
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return [] as SessionInfo[];
      }
      const jsonl = entries.filter(
        (ent) => ent.isFile() && ent.name.endsWith(".jsonl"),
      );
      const stats = await Promise.all(
        jsonl.map(async (ent) => {
          const file = path.join(dir, ent.name);
          try {
            const stat = await fs.stat(file);
            return { ent, file, stat };
          } catch {
            return null;
          }
        }),
      );
      return stats
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .map(({ ent, file, stat }) => {
          const id = ent.name.replace(/\.jsonl$/, "");
          return {
            id,
            cwd,
            encodedDir,
            filePath: file,
            modifiedAt: stat.mtimeMs,
            active: now - stat.mtimeMs < ACTIVE_WINDOW_MS,
            runtime: runtimeMap.get(id),
          } satisfies SessionInfo;
        });
    }),
  );
  return perProject.flat().sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/**
 * 세션 전체(메인 + 서브에이전트) 본문을 한 문자열로 합치고, 캐시 키로 쓸 fingerprint도 함께 반환.
 * fingerprint는 모든 파일의 `(path, mtimeMs, size)`를 정렬해 직렬화한 값이라
 * 어느 파일 하나라도 변경되면 자동 무효화된다.
 *
 * 파일을 못 읽으면 null. 메인이 사라진 케이스도 포함.
 */
export async function readSessionBundle(
  mainJsonlPath: string,
): Promise<{ body: string; fingerprint: string } | null> {
  const files = await enumerateSessionFiles(mainJsonlPath);
  const stats = await Promise.all(
    files.map(async (p) => {
      try {
        const s = await fs.stat(p);
        return { p, mtimeMs: s.mtimeMs, size: s.size };
      } catch {
        return null;
      }
    }),
  );
  const alive = stats.filter((s): s is NonNullable<typeof s> => s !== null);
  if (alive.length === 0) return null;
  const fingerprint = alive
    .slice()
    .sort((a, b) => a.p.localeCompare(b.p))
    .map((s) => `${s.p}:${s.mtimeMs}:${s.size}`)
    .join("|");
  const bodies = await Promise.all(
    alive.map((s) =>
      fs.readFile(s.p, "utf8").catch(() => ""),
    ),
  );
  // 파일 사이에 빈 라인 보장 — split("\n")으로 라인을 자를 때 마지막 라인이 개행 없으면 다음 파일 첫 라인과 합쳐지는 것을 방지.
  const body = bodies.map((b) => (b.endsWith("\n") ? b : b + "\n")).join("");
  return { body, fingerprint };
}

/**
 * 메인 jsonl + 같은 세션의 서브에이전트 jsonl들의 절대 경로 목록을 반환한다.
 *
 * Claude Code는 서브에이전트(Task 도구) 호출이 발생하면 메인 jsonl과 별도로
 * `<sessionId>/subagents/agent-*.jsonl` 디렉토리를 만들어 각 서브에이전트의
 * 대화·도구 호출을 기록한다. 편집 파일/대화/트레이스가 누락 없이 보이려면
 * 메인과 모든 서브에이전트 파일을 함께 읽어야 한다.
 *
 * 서브에이전트 디렉토리가 없으면 메인 하나만 반환.
 */
export async function enumerateSessionFiles(
  mainJsonlPath: string,
): Promise<string[]> {
  const files = [mainJsonlPath];
  const sessionId = path.basename(mainJsonlPath, ".jsonl");
  const subagentDir = path.join(path.dirname(mainJsonlPath), sessionId, "subagents");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(subagentDir);
  } catch {
    return files;
  }
  for (const name of entries) {
    if (name.endsWith(".jsonl")) files.push(path.join(subagentDir, name));
  }
  return files;
}

/**
 * 서브에이전트 agentId → 부모 Agent tool_use_id 매핑을 만든다.
 *
 * 매칭 키:
 * 1. subagent jsonl 첫 라인의 `promptId` ↔ 메인 jsonl 어떤 라인의 `promptId` (turn 식별)
 * 2. `<agentDir>/agent-<id>.meta.json`의 `description` ↔ 메인 Agent tool_use input의 `description`
 *
 * 같은 turn(promptId)에 여러 Agent가 spawn되면 description으로 1:1 disambiguate.
 * jsonl 필드 + 별도 메타 파일을 직접 매칭하므로 결과 텍스트 형식 변동에 영향 없음.
 *
 * 서브에이전트 디렉토리가 없거나 메인을 못 읽으면 빈 맵.
 */
export async function buildSubagentParentMap(
  mainJsonlPath: string,
): Promise<Record<string, string>> {
  const sessionId = path.basename(mainJsonlPath, ".jsonl");
  const subagentDir = path.join(path.dirname(mainJsonlPath), sessionId, "subagents");
  let entries: string[];
  try {
    entries = await fs.readdir(subagentDir);
  } catch {
    return {};
  }
  // (agentId, promptId, description) 수집.
  const subs = await Promise.all(
    entries
      .filter((name) => name.startsWith("agent-") && name.endsWith(".jsonl"))
      .map(async (name) => {
        const agentId = name.slice("agent-".length, -".jsonl".length);
        const jsonlPath = path.join(subagentDir, name);
        const metaPath = path.join(subagentDir, `agent-${agentId}.meta.json`);
        const [firstLine, metaRaw] = await Promise.all([
          readFirstLine(jsonlPath),
          fs.readFile(metaPath, "utf8").catch(() => null),
        ]);
        let promptId: string | null = null;
        try {
          const obj = firstLine ? (JSON.parse(firstLine) as { promptId?: string }) : null;
          if (obj && typeof obj.promptId === "string") promptId = obj.promptId;
        } catch {
          // ignore
        }
        let description: string | null = null;
        if (metaRaw) {
          try {
            const meta = JSON.parse(metaRaw) as { description?: string };
            if (typeof meta.description === "string") description = meta.description;
          } catch {
            // ignore
          }
        }
        return { agentId, promptId, description };
      }),
  );
  if (subs.length === 0) return {};

  // 메인을 한 번 훑어 promptId → Agent tool_use 후보 모음.
  // Claude Code jsonl에서 promptId는 user 라인에만 명시된다. 같은 turn의 assistant 라인(Agent tool_use가 들어있는)은
  // promptId가 null이라 직전 user 라인의 promptId를 상속받아 attribute해야 한다.
  let mainRaw: string;
  try {
    mainRaw = await fs.readFile(mainJsonlPath, "utf8");
  } catch {
    return {};
  }
  type AgentUse = { id: string; description: string | null };
  const agentUsesByPromptId = new Map<string, AgentUse[]>();
  let currentPromptId: string | null = null;
  for (const line of mainRaw.split("\n")) {
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof obj.promptId === "string") currentPromptId = obj.promptId;
    if (!currentPromptId) continue;
    const msg = obj.message as { content?: unknown } | undefined;
    const content = msg?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || typeof b !== "object") continue;
      const block = b as Record<string, unknown>;
      if (block.type !== "tool_use" || block.name !== "Agent") continue;
      const id = typeof block.id === "string" ? (block.id as string) : "";
      const input = block.input as Record<string, unknown> | undefined;
      const description =
        input && typeof input.description === "string"
          ? (input.description as string)
          : null;
      if (!id) continue;
      let arr = agentUsesByPromptId.get(currentPromptId);
      if (!arr) {
        arr = [];
        agentUsesByPromptId.set(currentPromptId, arr);
      }
      arr.push({ id, description });
    }
  }

  const out: Record<string, string> = {};
  for (const sub of subs) {
    if (!sub.promptId) continue;
    const candidates = agentUsesByPromptId.get(sub.promptId) ?? [];
    if (candidates.length === 0) continue;
    // 1) description 일치 우선.
    const match =
      candidates.find((c) => c.description === sub.description) ??
      // 2) 후보가 하나뿐이면 그것.
      (candidates.length === 1 ? candidates[0] : undefined);
    if (match) out[sub.agentId] = match.id;
  }
  return out;
}

/** jsonl 첫 라인만 읽어 반환. 큰 파일 전체를 메모리에 올리지 않게 64KB만 stream. */
async function readFirstLine(filePath: string): Promise<string | null> {
  try {
    const fh = await fs.open(filePath, "r");
    try {
      const buf = Buffer.alloc(64 * 1024);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      if (bytesRead === 0) return null;
      const text = buf.subarray(0, bytesRead).toString("utf8");
      const nl = text.indexOf("\n");
      return nl >= 0 ? text.slice(0, nl) : text;
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

/**
 * 단일 jsonl 절대 경로로 SessionInfo를 만든다.
 * listAllSessions를 다시 부르지 않고 stat 1회 + runtime 매칭으로 끝낸다.
 * @returns 파일이 없으면 null.
 */
export async function readSessionInfo(absJsonlPath: string): Promise<SessionInfo | null> {
  let stat;
  try {
    stat = await fs.stat(absJsonlPath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const id = path.basename(absJsonlPath, ".jsonl");
  const root = projectsDir();
  const rel = path.relative(root, absJsonlPath);
  // rel = "<encoded>/<id>.jsonl"
  const encodedDir = rel.split(path.sep)[0] ?? "";
  const cwd = decodeForDisplay(encodedDir);
  const runtimeMap = await readAllRuntimeStatuses();
  return {
    id,
    cwd,
    encodedDir,
    filePath: absJsonlPath,
    modifiedAt: stat.mtimeMs,
    active: Date.now() - stat.mtimeMs < ACTIVE_WINDOW_MS,
    runtime: runtimeMap.get(id),
  };
}

/**
 * 세션 jsonl의 라인들을 훑어 첫 번째로 발견되는 `cwd` 필드를 반환.
 * Claude Code는 user/assistant 라인에 `cwd`를 같이 기록하므로 디스플레이용 디코딩보다 정확하다.
 * 파일이 없거나 cwd 필드를 찾지 못하면 undefined.
 */
export async function readSessionCwd(jsonlPath: string): Promise<string | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(jsonlPath, "utf8");
  } catch {
    return undefined;
  }
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (typeof obj?.cwd === "string" && obj.cwd.length > 0) return obj.cwd;
    } catch {
      // 손상 라인 건너뜀.
    }
  }
  return undefined;
}

/**
 * 특정 프로젝트 디렉토리(cwd)에 해당하는 세션만 필터링.
 * 인코딩된 형태로 비교한다 — 경로에 `-`가 포함되어도 정확히 매칭된다.
 *
 * 매칭 범위:
 *   1) 정확 일치
 *   2) 세션이 프로젝트 하위 디렉토리에서 시작 (session ⊂ project)
 *
 * 상위 디렉토리에서 시작된 세션은 의도적으로 제외 — 다른 프로젝트의 세션이
 * 같이 끌려와 노이즈가 된다. 사용자가 모노레포 상위에서 claude를 띄운다면
 * 프로젝트를 그 상위 디렉토리로 등록해야 한다.
 */
export async function listSessionsForCwd(cwd: string): Promise<SessionInfo[]> {
  const targetEncoded = encodePath(cwd);
  const all = await listAllSessions();
  return all.filter(
    (s) =>
      s.encodedDir === targetEncoded ||
      s.encodedDir.startsWith(`${targetEncoded}-`),
  );
}
