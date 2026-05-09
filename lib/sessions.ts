import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readAllRuntimeStatuses, type RuntimeStatus } from "./session-extras";

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
