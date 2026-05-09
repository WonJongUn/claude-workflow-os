import fs from "node:fs/promises";
import path from "node:path";
import { getProject } from "./project-store";

export type EntryKind = "agent" | "skill";

class EntryNotFoundError extends Error {}
class InvalidEntryNameError extends Error {}

const DIR_BY_KIND: Record<EntryKind, string> = {
  agent: "agents",
  skill: "skills",
};

/**
 * Claude Code 규약:
 *   - agent: `<.claude>/agents/<name>.md`  (평탄 파일)
 *   - skill: `<.claude>/skills/<name>/SKILL.md`  (디렉토리 + SKILL.md)
 * skill을 평탄 파일로 두면 Claude Code가 인식하지 못한다.
 */
function newEntryPath(claudeRoot: string, kind: EntryKind, name: string): string {
  const base = path.join(claudeRoot, DIR_BY_KIND[kind]);
  return kind === "skill"
    ? path.join(base, name, "SKILL.md")
    : path.join(base, `${name}.md`);
}

/** 같은 entry가 평탄 형식으로 남아있을 수도 있어, 읽기/삭제 시 둘 다 검사한다. */
function legacyFlatPath(claudeRoot: string, kind: EntryKind, name: string): string {
  return path.join(claudeRoot, DIR_BY_KIND[kind], `${name}.md`);
}

function assertSafeName(name: string): void {
  if (!name || /[\\/]|\.\./.test(name)) {
    throw new InvalidEntryNameError(`Invalid name: ${name}`);
  }
}

/**
 * 엔트리 본문 저장. 파일/디렉토리는 없으면 생성한다.
 * skill은 디렉토리 형식으로 저장 — 기존 평탄 파일이 남아있다면 정리해 중복을 피한다.
 */
export async function saveEntry(input: {
  /** 프로젝트 id. */
  projectId: string;
  /** 종류: agent 또는 skill. */
  kind: EntryKind;
  /** 파일명 (확장자 제외). */
  name: string;
  /** 마크다운 본문. */
  body: string;
}): Promise<void> {
  assertSafeName(input.name);
  const project = await getProject(input.projectId);
  const file = newEntryPath(project.claudeRoot, input.kind, input.name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, input.body, "utf8");
  if (input.kind === "skill") {
    // 같은 이름의 평탄 파일이 있으면 제거 — 중복 등록을 방지.
    await fs
      .unlink(legacyFlatPath(project.claudeRoot, input.kind, input.name))
      .catch(() => {});
  }
}

/**
 * 엔트리 삭제. 디렉토리/평탄 두 형식 모두 시도. 어느 쪽도 없으면 EntryNotFoundError.
 */
export async function deleteEntry(input: {
  projectId: string;
  kind: EntryKind;
  name: string;
}): Promise<void> {
  assertSafeName(input.name);
  const project = await getProject(input.projectId);
  const dirFile = newEntryPath(project.claudeRoot, input.kind, input.name);
  const flatFile = legacyFlatPath(project.claudeRoot, input.kind, input.name);
  let removed = false;
  try {
    if (input.kind === "skill") {
      // 디렉토리 통째로 제거.
      await fs.rm(path.dirname(dirFile), { recursive: true, force: true });
      removed = true;
    } else {
      await fs.unlink(dirFile);
      removed = true;
    }
  } catch {
    // pass: try flat below.
  }
  try {
    await fs.unlink(flatFile);
    removed = true;
  } catch {
    // pass.
  }
  if (!removed) {
    throw new EntryNotFoundError(`Entry not found: ${input.kind}/${input.name}`);
  }
}

export { EntryNotFoundError, InvalidEntryNameError };
