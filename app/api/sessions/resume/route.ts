import { z } from "zod";
import { findSessionPathById } from "@/lib/session-lookup";
import { listAllSessions, readSessionCwd } from "@/lib/sessions";
import { effectiveSettings } from "@/lib/app-settings";
import { runClaudeInTerminal } from "@/lib/terminal-launcher";

import { withMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  /** 이어갈 세션 id (UUID). */
  sessionId: z.string().min(1),
});

/**
 * 기존 Claude Code 세션을 `claude --resume <id>`로 이어간다.
 * 세션의 jsonl에서 cwd를 읽어 그 디렉토리에서 실행한다 (인코딩 디코딩보다 정확).
 * 못 읽으면 SessionInfo의 디스플레이 cwd를 폴백으로 사용. macOS 전용.
 */
async function _POST(request: Request) {
  if (process.platform !== "darwin") {
    return Response.json(
      { error: "현재는 macOS에서만 지원합니다." },
      { status: 501 },
    );
  }
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const abs = await findSessionPathById(parsed.data.sessionId);
  if (!abs) return Response.json({ error: "not found" }, { status: 404 });
  const all = await listAllSessions();
  const found = all.find((s) => s.filePath === abs);
  if (!found) return Response.json({ error: "not found" }, { status: 404 });
  if (found.runtime) {
    return Response.json(
      {
        error: "이미 실행 중인 세션입니다. 종료 후 다시 시도해주세요.",
      },
      { status: 409 },
    );
  }
  const cwd = (await readSessionCwd(abs)) ?? found.cwd;
  const settings = await effectiveSettings();
  runClaudeInTerminal({
    cwd,
    claudeBinaryPath: settings.claudeBinaryPath,
    terminalApp: settings.terminalApp,
    useTmux: settings.useTmux,
    permissionMode: settings.permissionMode,
    resumeSessionId: found.id,
  });
  return Response.json({
    cwd,
    sessionId: found.id,
    terminalApp: settings.terminalApp,
    useTmux: settings.useTmux,
  });
}

export const POST = withMetrics("/api/sessions/resume", _POST);
