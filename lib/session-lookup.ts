import fs from "node:fs/promises";
import path from "node:path";
import { createCache } from "./cache";
import { projectsDir } from "./sessions";

/**
 * 세션 id (UUID) → 절대 jsonl 경로 캐시.
 * Claude Code는 `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` 형태로 저장하므로
 * id만으로 조회하려면 모든 프로젝트 디렉토리를 스캔해야 한다. 결과를 캐시해 반복 호출 비용을 0으로.
 *
 * 캐시 hit 시 fs.access로 파일 존재 확인, 누락이면 invalidate 후 재스캔.
 * (사용자가 세션을 삭제하면 path는 사라지지만 캐시에는 남아있을 수 있어 매 hit마다 검증.)
 */
const cache = createCache<string, string>("session-path");

/**
 * 세션 id로 jsonl 절대 경로를 찾는다.
 * @returns 발견된 절대 경로, 또는 null (없음).
 */
export async function findSessionPathById(
  id: string,
): Promise<string | null> {
  if (!id) return null;
  const cached = cache.get(id);
  if (cached) {
    try {
      await fs.access(cached);
      return cached;
    } catch {
      cache.delete(id);
    }
  }
  const found = await scanForId(id);
  if (found) cache.set(id, found);
  return found;
}

/**
 * `~/.claude/projects/*` 모든 인코딩 디렉토리에서 `<id>.jsonl`을 찾는다.
 * 첫 번째 매칭을 반환 — UUID라 충돌 가능성은 사실상 0.
 */
async function scanForId(id: string): Promise<string | null> {
  const root = projectsDir();
  let projectDirs: string[];
  try {
    projectDirs = await fs.readdir(root);
  } catch {
    return null;
  }
  const candidates = await Promise.all(
    projectDirs.map(async (encoded) => {
      const candidate = path.join(root, encoded, `${id}.jsonl`);
      try {
        const stat = await fs.stat(candidate);
        return stat.isFile() ? candidate : null;
      } catch {
        return null;
      }
    }),
  );
  return candidates.find((c): c is string => c !== null) ?? null;
}
