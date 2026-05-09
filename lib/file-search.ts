import fs from "node:fs/promises";
import path from "node:path";
import { ALL_PROJECT, getProject } from "./project-store";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  "build",
  "out",
  ".cache",
  ".vercel",
  ".pnpm-store",
]);

const MAX_TRAVERSE = 5000;

/** searchFiles의 결과 한 건. ReferencesInput @ 자동완성에서 소비. */
export type FileHit = {
  /** searchRoot 기준 상대 경로. UI 표시용. */
  relative: string;
  /** 절대 경로. */
  absolute: string;
};

/**
 * 프로젝트의 검색 기준 디렉토리. 사용자 정의 프로젝트는 .claude의 부모,
 * 글로벌(ALL)은 .claude 디렉토리 자신을 사용한다.
 */
export async function getSearchRoot(projectId: string): Promise<string> {
  if (projectId === ALL_PROJECT.id) return ALL_PROJECT.claudeRoot;
  const project = await getProject(projectId);
  return path.dirname(project.claudeRoot);
}

/**
 * baseDir 아래에서 파일명에 query가 포함되는 파일을 찾는다.
 * 얕은 깊이의 파일을 우선해서 보여주기 위해 BFS 순회한다.
 */
export async function searchFiles(
  baseDir: string,
  query: string,
  limit = 50,
): Promise<FileHit[]> {
  const needle = query.trim().toLowerCase();
  const hits: FileHit[] = [];
  const queue: string[] = [baseDir];
  let visited = 0;

  while (queue.length > 0 && hits.length < limit && visited < MAX_TRAVERSE) {
    const dir = queue.shift()!;
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    visited += dirents.length;

    const subdirs: string[] = [];
    for (const ent of dirents) {
      if (hits.length >= limit) break;
      if (ent.name.startsWith(".") && ent.name !== ".claude") continue;
      if (ent.isDirectory()) {
        if (!IGNORED_DIRS.has(ent.name)) subdirs.push(path.join(dir, ent.name));
        continue;
      }
      if (ent.isFile() && (!needle || ent.name.toLowerCase().includes(needle))) {
        const abs = path.join(dir, ent.name);
        hits.push({ relative: path.relative(baseDir, abs), absolute: abs });
      }
    }
    queue.push(...subdirs);
  }

  return hits;
}
