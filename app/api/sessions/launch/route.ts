import path from "node:path";
import { z } from "zod";
import {
  ALL_PROJECT,
  ProjectNotFoundError,
  getProject,
} from "@/lib/project-store";
import { effectiveSettings } from "@/lib/app-settings";
import { runClaudeInTerminal } from "@/lib/terminal-launcher";

import { withMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  /** 새 세션을 띄울 프로젝트 id. ALL은 거부. */
  projectId: z.string().min(1),
  /** 시작 프롬프트. 비우거나 미지정이면 빈 세션으로 시작. */
  initialPrompt: z.string().optional(),
  /** true면 설정의 기본 프롬프트를 합치지 않고 빈 세션으로 시작. */
  ignoreDefaultPrompt: z.boolean().optional(),
});

/**
 * Terminal/iTerm/Ghostty 중 하나를 띄워 프로젝트의 workDir에서 `claude`를 실행한다.
 * macOS 전용 (osascript / open -na). 다른 OS는 501.
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
  const { projectId, initialPrompt, ignoreDefaultPrompt } = parsed.data;
  if (projectId === ALL_PROJECT.id) {
    return Response.json(
      { error: "프로젝트를 선택해주세요. (전체에서는 실행 불가)" },
      { status: 400 },
    );
  }
  try {
    const project = await getProject(projectId);
    const cwd = resolveCwd(project.workDir, project.claudeRoot);
    const settings = await effectiveSettings();
    const basePrompt = ignoreDefaultPrompt ? undefined : settings.defaultPrompt;
    const promptToUse = mergePrompts(basePrompt, initialPrompt);
    runClaudeInTerminal({
      cwd,
      claudeBinaryPath: settings.claudeBinaryPath,
      terminalApp: settings.terminalApp,
      initialPrompt: promptToUse,
      useTmux: settings.useTmux,
      permissionMode: settings.permissionMode,
    });
    return Response.json({
      cwd,
      terminalApp: settings.terminalApp,
      useTmux: settings.useTmux,
      permissionMode: settings.permissionMode,
    });
  } catch (err) {
    if (err instanceof ProjectNotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

/**
 * 기본 프롬프트(설정값)와 사용자 입력 프롬프트를 합친다.
 * - 둘 다 비면 undefined.
 * - 둘 다 있으면 `<base>\n<input>`.
 * - 한쪽만 있으면 그 값.
 */
function mergePrompts(
  base: string | undefined,
  input: string | undefined,
): string | undefined {
  const b = base?.trim() ?? "";
  const i = input?.trim() ?? "";
  if (!b && !i) return undefined;
  if (b && i) return `${b}\n${i}`;
  return b || i;
}

/** workDir이 명시되어 있으면 그것을, 아니면 .claude의 부모(또는 자신)를 cwd로 사용. */
function resolveCwd(workDir: string | undefined, claudeRoot: string): string {
  if (workDir) return workDir;
  if (claudeRoot.endsWith(`${path.sep}.claude`)) return path.dirname(claudeRoot);
  return claudeRoot;
}

export const POST = withMetrics("/api/sessions/launch", _POST);
