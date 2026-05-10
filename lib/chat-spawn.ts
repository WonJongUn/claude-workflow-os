import { spawn } from "node:child_process";
import path from "node:path";
import { effectiveSettings } from "./app-settings";

/** in-page chatbot 한 턴을 spawn하기 위한 옵션. */
export type ChatSpawnOptions = {
  /** claude를 실행할 작업 디렉토리. 보통 프로젝트 workDir. */
  cwd: string;
  /** 사용자 메시지(이번 턴 입력). */
  prompt: string;
  /** 이어갈 세션 id. 없으면 새 세션. */
  resumeSessionId?: string;
};

/**
 * stream-json 이벤트 한 줄.
 * Claude Code headless 출력의 union으로, type별로 의미가 다르다.
 * 미지원 type은 unknown으로 떨어진다 — 호출자는 type을 보고 분기해야 한다.
 */
export type ClaudeStreamEvent =
  | { type: "system"; subtype: string; session_id?: string; [k: string]: unknown }
  | {
      type: "assistant";
      message: {
        content: Array<
          | { type: "text"; text: string }
          | { type: "tool_use"; id: string; name: string; input: unknown }
          | { type: string; [k: string]: unknown }
        >;
      };
      [k: string]: unknown;
    }
  | {
      type: "user";
      message: {
        content: Array<
          | { type: "tool_result"; tool_use_id: string; content?: unknown }
          | { type: string; [k: string]: unknown }
        >;
      };
      [k: string]: unknown;
    }
  | { type: "result"; subtype: string; result?: string; session_id?: string; [k: string]: unknown }
  | { type: string; [k: string]: unknown };

/**
 * `claude -p` headless를 spawn해 stream-json을 한 줄씩 yield하는 async iterator를 반환.
 * 권한은 bypassPermissions로 강제(in-page 챗봇은 사용자가 직접 승인할 수 없으므로).
 * 비정상 종료 시에도 close 이벤트가 한 번 yield되어 호출자가 SSE 종료를 트리거할 수 있다.
 */
export async function* spawnChatTurn(
  opts: ChatSpawnOptions,
  signal?: AbortSignal,
): AsyncGenerator<ClaudeStreamEvent> {
  const settings = await effectiveSettings();
  const bin = settings.claudeBinaryPath || "claude";

  const args = [
    "-p",
    opts.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "bypassPermissions",
  ];
  if (opts.resumeSessionId) {
    args.push("--resume", opts.resumeSessionId);
  }

  const proc = spawn(bin, args, {
    cwd: opts.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  const onAbort = () => {
    if (!proc.killed) proc.kill("SIGTERM");
  };
  signal?.addEventListener("abort", onAbort);

  const queue: ClaudeStreamEvent[] = [];
  let waiter: (() => void) | null = null;
  let done = false;
  let errorMsg: string | null = null;
  let stderrBuf = "";

  const wake = () => {
    const w = waiter;
    waiter = null;
    w?.();
  };

  let buf = "";
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk: string) => {
    buf += chunk;
    let nl = buf.indexOf("\n");
    while (nl !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) {
        try {
          queue.push(JSON.parse(line) as ClaudeStreamEvent);
          wake();
        } catch {
          // 파싱 실패 라인은 무시 (예: 디버그 출력).
        }
      }
      nl = buf.indexOf("\n");
    }
  });

  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk: string) => {
    stderrBuf += chunk;
    if (stderrBuf.length > 8_000) stderrBuf = stderrBuf.slice(-8_000);
  });

  proc.on("error", (err) => {
    errorMsg = err.message;
    done = true;
    wake();
  });

  proc.on("close", (code) => {
    if (code !== 0 && !errorMsg) {
      errorMsg = `claude exited with code ${code}${stderrBuf ? `: ${stderrBuf.trim()}` : ""}`;
    }
    done = true;
    wake();
  });

  try {
    while (true) {
      while (queue.length > 0) {
        yield queue.shift()!;
      }
      if (done) break;
      await new Promise<void>((resolve) => {
        waiter = resolve;
      });
    }
    if (errorMsg) {
      yield { type: "error", error: errorMsg };
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (!proc.killed) proc.kill("SIGTERM");
  }
}

/** workDir이 있으면 그 값, 없으면 .claude의 부모 디렉토리를 cwd로. */
export function resolveChatCwd(
  workDir: string | undefined,
  claudeRoot: string,
): string {
  if (workDir) return workDir;
  if (claudeRoot.endsWith(`${path.sep}.claude`)) return path.dirname(claudeRoot);
  return claudeRoot;
}
