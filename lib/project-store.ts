import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Project } from "./types";
import { ticketsDir } from "./paths";

/**
 * 항상 첫 번째 탭으로 표시되는 글로벌 프로젝트. 삭제 불가.
 */
export const ALL_PROJECT: Project = {
  id: "ALL",
  name: "전체",
  claudeRoot:
    process.env.CLAUDE_PROJECT_ROOT ?? path.join(os.homedir(), ".claude"),
};

class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project not found: ${id}`);
  }
}

class ProtectedProjectError extends Error {
  constructor() {
    super("'전체' 탭은 삭제할 수 없습니다.");
  }
}

class DuplicateProjectError extends Error {
  constructor() {
    super("이미 같은 경로의 프로젝트가 등록되어 있습니다.");
  }
}

function storePath(): string {
  return path.join(ticketsDir(), ".projects.json");
}

async function readUserProjects(): Promise<Project[]> {
  try {
    const raw = await fs.readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as Project[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeUserProjects(projects: Project[]): Promise<void> {
  await fs.mkdir(ticketsDir(), { recursive: true });
  await fs.writeFile(storePath(), JSON.stringify(projects, null, 2), "utf8");
}

/**
 * 전체(ALL) + 사용자 정의 프로젝트 목록. 전체가 항상 첫 번째.
 * 저장된 claudeRoot가 프로젝트 루트로 들어있는 항목은 표시 시 .claude로 보정된다.
 */
export async function listProjects(): Promise<Project[]> {
  const user = await readUserProjects();
  const normalized = await Promise.all(
    user.map(async (p) => ({
      ...p,
      claudeRoot: await normalizeClaudeRoot(p.claudeRoot),
    })),
  );
  return [ALL_PROJECT, ...normalized];
}

/**
 * 프로젝트 단건 조회. 미존재 시 ProjectNotFoundError.
 * 저장된 claudeRoot가 프로젝트 루트(하위에 `.claude` 보유)인 경우 lazy하게 보정한다.
 */
export async function getProject(id: string): Promise<Project> {
  if (id === ALL_PROJECT.id) return ALL_PROJECT;
  const user = await readUserProjects();
  const found = user.find((p) => p.id === id);
  if (!found) throw new ProjectNotFoundError(id);
  const normalized = await normalizeClaudeRoot(found.claudeRoot);
  if (normalized !== found.claudeRoot) {
    return { ...found, claudeRoot: normalized };
  }
  return found;
}

/**
 * 사용자가 프로젝트 루트를 골랐을 때 .claude 하위로 자동 보정.
 */
async function normalizeClaudeRoot(input: string): Promise<string> {
  const resolved = path.resolve(input);
  if (resolved.endsWith(`${path.sep}.claude`)) return resolved;
  const candidate = path.join(resolved, ".claude");
  try {
    const stat = await fs.stat(candidate);
    if (stat.isDirectory()) return candidate;
  } catch {
    // 하위에 .claude가 없으면 원래 경로 그대로 사용.
  }
  return resolved;
}

/**
 * 프로젝트 생성. 같은 claudeRoot가 이미 있으면 거부.
 * 사용자가 프로젝트 루트를 입력해도 .claude 하위가 있으면 자동 보정한다.
 */
export async function createProject(
  input: Pick<Project, "name" | "claudeRoot"> & { workDir?: string },
): Promise<Project> {
  const user = await readUserProjects();
  const normalizedRoot = await normalizeClaudeRoot(input.claudeRoot);
  if (
    user.some((p) => p.claudeRoot === normalizedRoot) ||
    normalizedRoot === ALL_PROJECT.claudeRoot
  ) {
    throw new DuplicateProjectError();
  }
  const project: Project = {
    id: generateId(),
    name: input.name.trim(),
    claudeRoot: normalizedRoot,
    workDir: input.workDir ? path.resolve(input.workDir) : undefined,
  };
  await writeUserProjects([...user, project]);
  return project;
}

/**
 * 프로젝트 일부 필드 갱신. ALL은 변경 불가.
 */
export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, "name" | "workDir">>,
): Promise<Project> {
  if (id === ALL_PROJECT.id) throw new ProtectedProjectError();
  const user = await readUserProjects();
  const idx = user.findIndex((p) => p.id === id);
  if (idx === -1) throw new ProjectNotFoundError(id);
  const next: Project = {
    ...user[idx],
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.workDir !== undefined
      ? {
          workDir: patch.workDir.trim()
            ? path.resolve(patch.workDir.trim())
            : undefined,
        }
      : {}),
  };
  const nextList = [...user];
  nextList[idx] = next;
  await writeUserProjects(nextList);
  return next;
}

/**
 * 프로젝트 삭제. ALL은 보호되어 거부된다.
 */
export async function deleteProject(id: string): Promise<void> {
  if (id === ALL_PROJECT.id) throw new ProtectedProjectError();
  const user = await readUserProjects();
  const next = user.filter((p) => p.id !== id);
  if (next.length === user.length) throw new ProjectNotFoundError(id);
  await writeUserProjects(next);
}

function generateId(): string {
  return `P-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 도메인 에러. 라우트는 errorStatus 헬퍼로 HTTP 상태에 매핑한다:
 * - ProjectNotFoundError → 404
 * - ProtectedProjectError → 409 (ALL 탭 보호)
 * - DuplicateProjectError → 409 (같은 claudeRoot 중복)
 */
export { ProjectNotFoundError, ProtectedProjectError, DuplicateProjectError };
