import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { effectiveSettings } from "@/lib/app-settings";

import { withMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 응답 형태. */
export type SystemCheck = {
  /** PATH(또는 사용자 지정 경로)에 `claude` 실행 파일이 있는지. */
  claude: boolean;
  /** `which claude`로 찾은 실제 경로. placeholder 자동완성에 사용. 못 찾으면 null. */
  claudePath: string | null;
  /** PATH에 `tmux` 실행 파일이 있는지. */
  tmux: boolean;
  /** macOS 앱 설치 여부 (`/Applications` 경로 존재 검사). 실행 중 여부와 무관. */
  terminals: {
    /** Apple 기본 Terminal.app. */
    Terminal: boolean;
    /** iTerm2. */
    iTerm: boolean;
    /** Ghostty. */
    Ghostty: boolean;
  };
};

const TERMINAL_PATHS: Record<keyof SystemCheck["terminals"], string[]> = {
  Terminal: [
    "/System/Applications/Utilities/Terminal.app",
    "/Applications/Utilities/Terminal.app",
  ],
  iTerm: ["/Applications/iTerm.app"],
  Ghostty: ["/Applications/Ghostty.app"],
};

async function _GET() {
  const settings = await effectiveSettings();
  const [claudePath, tmux, Terminal, iTerm, Ghostty] = await Promise.all([
    whichPath("claude"),
    which("tmux"),
    anyExists(TERMINAL_PATHS.Terminal),
    anyExists(TERMINAL_PATHS.iTerm),
    anyExists(TERMINAL_PATHS.Ghostty),
  ]);
  // claude 설치 판정: 사용자가 경로를 지정했으면 그 파일 존재성, 아니면 PATH 검색 결과.
  const claude = settings.claudeBinaryPath
    ? await fileExists(settings.claudeBinaryPath)
    : claudePath !== null;
  const result: SystemCheck = {
    claude,
    claudePath,
    tmux,
    terminals: { Terminal, iTerm, Ghostty },
  };
  return Response.json(result);
}

/** 셸 PATH에서 실행 파일을 찾는다 (`/usr/bin/which`). 존재만 확인. */
function which(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("/usr/bin/which", [bin], { stdio: "ignore" });
    proc.on("error", () => resolve(false));
    proc.on("exit", (code) => resolve(code === 0));
  });
}

/** `/usr/bin/which`로 첫 번째 매치 절대 경로를 받아온다. 못 찾으면 null. */
function whichPath(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    let out = "";
    const proc = spawn("/usr/bin/which", [bin], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    proc.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    proc.on("error", () => resolve(null));
    proc.on("exit", (code) => {
      if (code !== 0) return resolve(null);
      const path = out.trim().split("\n")[0]?.trim() ?? "";
      resolve(path || null);
    });
  });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function anyExists(paths: string[]): Promise<boolean> {
  for (const p of paths) {
    if (await fileExists(p)) return true;
  }
  return false;
}

export const GET = withMetrics("/api/system-check", _GET);
