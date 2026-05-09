import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type DirEntry = {
  /** 파일/디렉토리 이름. */
  name: string;
  /** 디렉토리 여부. */
  isDir: boolean;
};

export type DirListing = {
  /** 정규화된 절대 경로. */
  path: string;
  /** 부모 디렉토리. 루트면 null. */
  parent: string | null;
  /** 자식 항목들. 디렉토리 우선, 이름 오름차순. */
  entries: DirEntry[];
  /** 이 경로에 .claude 디렉토리가 존재하는지. UI 힌트용. */
  hasClaude: boolean;
};

class InvalidPathError extends Error {}

/**
 * 디렉토리 한 단계 목록을 읽는다. 점-파일/디렉토리는 표시하지만 권한 에러는 무시.
 * @param target 절대 경로. 미지정 시 사용자 홈.
 */
export async function browseDirectory(target?: string): Promise<DirListing> {
  const resolved = path.resolve(target?.trim() || os.homedir());
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new InvalidPathError(`Path not found: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new InvalidPathError(`Not a directory: ${resolved}`);
  }

  let entries: DirEntry[] = [];
  try {
    const dirents = await fs.readdir(resolved, { withFileTypes: true });
    entries = dirents
      .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
      .sort(byDirThenName);
  } catch {
    entries = [];
  }

  const parent = path.dirname(resolved);
  const hasClaude = entries.some((e) => e.isDir && e.name === ".claude");

  return {
    path: resolved,
    parent: parent === resolved ? null : parent,
    entries,
    hasClaude,
  };
}

function byDirThenName(a: DirEntry, b: DirEntry): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export { InvalidPathError };
