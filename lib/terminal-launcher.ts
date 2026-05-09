import { spawn } from "node:child_process";
import path from "node:path";
import type { PermissionMode, TerminalApp } from "./app-settings";

/** macOS 터미널에서 `claude`를 띄우기 위한 옵션. */
export type RunClaudeOptions = {
  /** 터미널이 진입할 작업 디렉토리. */
  cwd: string;
  /** `claude` 실행 파일 절대 경로. 비면 PATH의 `claude`. */
  claudeBinaryPath: string;
  /** Terminal / iTerm / Ghostty 중 하나. */
  terminalApp: TerminalApp;
  /** 시작 프롬프트. resumeSessionId와 함께 쓰지 않는다 (기존 세션 이어가기에는 의미 없음). */
  initialPrompt?: string;
  /** true면 새 tmux 세션 안에서 claude 실행. */
  useTmux?: boolean;
  /** "default" 외에는 `--permission-mode` 플래그로 전달. */
  permissionMode?: PermissionMode;
  /** 세션 이어가기. 있으면 `--resume <id>`로 실행하고 initialPrompt는 무시. */
  resumeSessionId?: string;
};

/**
 * 지정된 macOS 터미널 앱에서 `claude`를 실행한다. detached 비동기 실행이라 부모 프로세스
 * 생명주기와 분리된다. resumeSessionId가 있으면 새 세션 대신 `--resume <id>`로 이어간다.
 */
export function runClaudeInTerminal(opts: RunClaudeOptions): void {
  const {
    cwd,
    claudeBinaryPath,
    terminalApp,
    initialPrompt,
    useTmux,
    permissionMode,
    resumeSessionId,
  } = opts;
  const claudeCmd = claudeBinaryPath ? shellQuote(claudeBinaryPath) : "claude";
  const permissionFlag =
    permissionMode && permissionMode !== "default"
      ? ` --permission-mode ${permissionMode}`
      : "";
  const resumeFlag = resumeSessionId
    ? ` --resume ${shellQuote(resumeSessionId)}`
    : "";
  // resume 모드에선 prompt를 무시한다.
  const promptArg =
    !resumeSessionId && initialPrompt && initialPrompt.trim()
      ? ` ${shellQuote(initialPrompt)}`
      : "";
  const inner = `${claudeCmd}${permissionFlag}${resumeFlag}${promptArg}`;
  const baseCommand = useTmux
    ? `tmux new-session -s ${shellQuote(tmuxSessionName(cwd))} -- sh -lc ${shellQuote(inner)}`
    : inner;
  const cdCommand = `cd ${shellQuote(cwd)} && ${baseCommand}`;

  if (terminalApp === "Ghostty") {
    if (useTmux) {
      const proc = spawn(
        "open",
        [
          "-na",
          "Ghostty",
          "--args",
          `--working-directory=${cwd}`,
          "-e",
          "sh",
          "-lc",
          baseCommand,
        ],
        { stdio: "ignore", detached: true },
      );
      proc.unref();
      return;
    }
    const args = [
      "-na",
      "Ghostty",
      "--args",
      `--working-directory=${cwd}`,
      "-e",
      claudeBinaryPath || "claude",
    ];
    if (permissionMode && permissionMode !== "default") {
      args.push("--permission-mode", permissionMode);
    }
    if (resumeSessionId) {
      args.push("--resume", resumeSessionId);
    } else if (initialPrompt && initialPrompt.trim()) {
      args.push(initialPrompt);
    }
    const proc = spawn("open", args, { stdio: "ignore", detached: true });
    proc.unref();
    return;
  }

  const escaped = escapeAppleScriptString(cdCommand);
  const script =
    terminalApp === "iTerm"
      ? [
          `tell application "iTerm"`,
          `  create window with default profile`,
          `  tell current session of current window`,
          `    write text "${escaped}"`,
          `  end tell`,
          `  activate`,
          `end tell`,
        ].join("\n")
      : [
          `tell application "Terminal"`,
          `  do script "${escaped}"`,
          `  activate`,
          `end tell`,
        ].join("\n");
  const proc = spawn("osascript", [], {
    stdio: ["pipe", "ignore", "ignore"],
    detached: true,
  });
  proc.stdin.write(script);
  proc.stdin.end();
  proc.unref();
}

/**
 * tmux 세션 이름은 `claude-<cwd basename>-<unix-ms>`. 호출마다 고유하게 만들어
 * "즉시 실행"이 같은 cwd의 살아 있는 tmux 세션에 attach되지 않도록 한다.
 * tmux 식별자 규칙(영문/숫자/하이픈/언더스코어)에 맞춘다.
 */
function tmuxSessionName(cwd: string): string {
  const base = path.basename(cwd).replace(/[^a-zA-Z0-9_-]/g, "-");
  return `claude-${base}-${Date.now()}`;
}

/** POSIX 단일 따옴표 이스케이프. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** AppleScript 문자열 리터럴(이중 따옴표) 안에 들어갈 값 이스케이프. */
function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
