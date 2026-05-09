import fs from "node:fs/promises";
import path from "node:path";
import type { ClaudeContext, ContextEntry } from "./types";
import { projectRoot } from "./paths";

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * 두 가지 entry 형식을 모두 읽는다 — Claude Code의 skill 규약 호환:
 *   1. 평탄: `<dir>/<name>.md`
 *   2. 디렉토리: `<dir>/<name>/SKILL.md` (또는 AGENT.md)
 * 디렉토리 형식은 첫 번째로 발견되는 SKILL.md / AGENT.md 한 파일만 본문으로 본다.
 */
async function readMarkdownDir(dir: string): Promise<ContextEntry[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const results = await Promise.all(
    entries.map(async (e) => {
      if (e.isFile() && e.name.endsWith(".md")) {
        const full = path.join(dir, e.name);
        const body = (await readIfExists(full)) ?? "";
        return { name: e.name.replace(/\.md$/, ""), path: full, body };
      }
      if (e.isDirectory()) {
        for (const candidate of ["SKILL.md", "AGENT.md"]) {
          const full = path.join(dir, e.name, candidate);
          const body = await readIfExists(full);
          if (body !== null) return { name: e.name, path: full, body };
        }
      }
      return null;
    }),
  );
  return results
    .filter((r): r is ContextEntry => r !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * .claude 디렉토리를 읽어 컨텍스트 객체를 만든다.
 * @param root 명시적 경로. 미지정 시 환경변수/기본값 사용.
 */
export async function loadClaudeContext(root?: string): Promise<ClaudeContext> {
  const resolvedRoot = root ?? projectRoot();
  const [claudeMdBody, agents, skills, settingsBody] = await Promise.all([
    readIfExists(path.join(resolvedRoot, "CLAUDE.md")),
    readMarkdownDir(path.join(resolvedRoot, "agents")),
    readMarkdownDir(path.join(resolvedRoot, "skills")),
    readIfExists(path.join(resolvedRoot, "settings.json")),
  ]);

  const settingsPath = path.join(resolvedRoot, "settings.json");
  let rules: ClaudeContext["rules"] = null;
  if (settingsBody) {
    try {
      const raw = JSON.parse(settingsBody) as Record<string, unknown>;
      rules = {
        permissions: raw.permissions,
        hooks: raw.hooks,
        raw,
        path: settingsPath,
        body: settingsBody,
      };
    } catch {
      rules = {
        raw: settingsBody,
        path: settingsPath,
        body: settingsBody,
      };
    }
  }

  return {
    projectRoot: resolvedRoot,
    claudeMd: claudeMdBody
      ? {
          name: "CLAUDE.md",
          path: path.join(resolvedRoot, "CLAUDE.md"),
          body: claudeMdBody,
        }
      : null,
    agents,
    skills,
    rules,
  };
}
