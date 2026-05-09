import { z } from "zod";
import {
  type AppSettings,
  readAppSettings,
  writeAppSettings,
} from "@/lib/app-settings";

import { withMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  /** claude 실행 파일 경로. 빈 문자열이면 PATH 사용. */
  claudeBinaryPath: z.string().optional(),
  /** Terminal / iTerm / Ghostty 중 선택. */
  terminalApp: z.enum(["Terminal", "iTerm", "Ghostty"]).optional(),
  /** 새 세션 실행 시 자동 입력할 시작 프롬프트. */
  defaultPrompt: z.string().optional(),
  /** tmux 안에서 새 세션을 띄울지 여부. */
  useTmux: z.boolean().optional(),
  /** Claude Code 권한 모드. */
  permissionMode: z
    .enum(["default", "acceptEdits", "bypassPermissions"])
    .optional(),
}) satisfies z.ZodType<AppSettings>;

async function _GET() {
  const settings = await readAppSettings();
  return Response.json(settings);
}

async function _PATCH(request: Request) {
  const parsed = PatchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const current = await readAppSettings();
  const next: AppSettings = { ...current, ...parsed.data };
  await writeAppSettings(next);
  return Response.json(next);
}

export const GET = withMetrics("/api/settings", _GET);

export const PATCH = withMetrics("/api/settings", _PATCH);
