import fs from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { createCache } from "@/lib/cache";
import { findSessionPathById } from "@/lib/session-lookup";
import {
  findRuntimeFileForSession,
  isPidAlive,
  readAllRuntimeStatuses,
} from "@/lib/session-extras";

import { withMetrics } from "@/lib/metrics";

// jsonl 본문 캐시. mtime+size 조합이면 본문 동일하다고 간주.
// 큰 세션(>1MB)은 readFile 자체가 비싸 폴링 폭주 시 디스크 부하의 주요 원인.
const fileBodyCache = createCache<
  string,
  { mtimeMs: number; size: number; body: string }
>("session-file-body");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 종료 신호 후 프로세스가 사라지길 기다리는 최대 시간(ms). */
const KILL_GRACE_MS = 1500;

/**
 * 세션 id (UUID)로 jsonl 절대 경로를 lookup.
 * 미존재 시 404 Response 반환.
 */
async function resolveSession(sessionId: string | null): Promise<string | Response> {
  if (!sessionId) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }
  const abs = await findSessionPathById(sessionId);
  if (!abs) return Response.json({ error: "not found" }, { status: 404 });
  return abs;
}

async function _GET(request: NextRequest) {
  const resolved = await resolveSession(request.nextUrl.searchParams.get("sessionId"));
  if (typeof resolved !== "string") return resolved;
  const abs = resolved;
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) {
      return Response.json({ error: "not a file" }, { status: 400 });
    }
    // ETag = mtime+size. jsonl이 append-only라 같은 etag면 본문도 동일 — stale 위험 0.
    const etag = `"${stat.mtimeMs}-${stat.size}"`;
    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch === etag) {
      // 본문/JSON 직렬화 모두 생략. 클라(브라우저)가 캐시된 응답을 그대로 사용.
      return new Response(null, {
        status: 304,
        headers: {
          etag,
          "cache-control": "private, max-age=0, must-revalidate",
        },
      });
    }
    const cached = fileBodyCache.get(abs);
    let body: string;
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      body = cached.body;
    } else {
      // 사용자 요청에 따라 상한 없이 전체 본문을 읽는다.
      body = await fs.readFile(abs, "utf8");
      fileBodyCache.set(abs, { mtimeMs: stat.mtimeMs, size: stat.size, body });
    }
    return new Response(
      JSON.stringify({ path: abs, size: stat.size, truncated: false, body }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          etag,
          "cache-control": "private, max-age=0, must-revalidate",
        },
      },
    );
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

/**
 * 세션 jsonl 파일을 영구 삭제한다.
 *
 * 동시 동작:
 * - 살아있는 Claude Code 프로세스가 매핑되어 있으면 SIGTERM(짧은 grace 후 SIGKILL).
 * - `~/.claude/sessions/<pid>.json` 런타임 파일도 함께 정리.
 *
 * 실패해도 jsonl 삭제는 best-effort로 계속 진행 — 사용자가 명시적으로 삭제를 요청한 흐름이므로.
 */
async function _DELETE(request: NextRequest) {
  const resolved = await resolveSession(request.nextUrl.searchParams.get("sessionId"));
  if (typeof resolved !== "string") return resolved;
  const sessionId = path.basename(resolved, ".jsonl");
  const runtimeMap = await readAllRuntimeStatuses();
  const runtime = runtimeMap.get(sessionId);
  let killed: { pid: number; method: "SIGTERM" | "SIGKILL" } | undefined;
  if (runtime && isPidAlive(runtime.pid)) {
    killed = await terminate(runtime.pid);
  }
  // sessionId로 매칭되는 runtime json도 삭제 (pid 기반 파일명이라 별도 lookup 필요).
  const runtimeFile = await findRuntimeFileForSession(sessionId);
  if (runtimeFile) {
    await fs.unlink(runtimeFile).catch(() => {
      // 이미 사라졌거나 권한 문제는 무시.
    });
  }
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      return Response.json({ error: "not a file" }, { status: 400 });
    }
    await fs.unlink(resolved);
    return Response.json({ killed }, { status: 200 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return Response.json({ error: "not found", killed }, { status: 404 });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error", killed },
      { status: 500 },
    );
  }
}

/**
 * SIGTERM을 보내고 KILL_GRACE_MS 동안 종료를 기다린다. 살아있으면 SIGKILL.
 * 실제 kill 호출이 권한 부족 등으로 실패하면 method: "SIGTERM"이라도 best-effort 신호 전송 결과로 반환.
 */
async function terminate(
  pid: number,
): Promise<{ pid: number; method: "SIGTERM" | "SIGKILL" }> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // 이미 죽었거나 권한 없음 — 결과만 보고하고 다음 단계.
  }
  const start = Date.now();
  while (Date.now() - start < KILL_GRACE_MS) {
    if (!isPidAlive(pid)) return { pid, method: "SIGTERM" };
    await new Promise((r) => setTimeout(r, 100));
  }
  if (isPidAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // 무시: 결과는 SIGKILL 시도로 보고.
    }
    return { pid, method: "SIGKILL" };
  }
  return { pid, method: "SIGTERM" };
}

export const GET = withMetrics("/api/sessions/file", _GET);

export const DELETE = withMetrics("/api/sessions/file", _DELETE);
