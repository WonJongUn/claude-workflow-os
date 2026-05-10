import fs from "node:fs/promises";
import path from "node:path";

/** 사용자가 지정 가능한 터미널 앱. macOS 한정. */
export type TerminalApp = "Terminal" | "iTerm" | "Ghostty";

/**
 * Claude Code의 `--permission-mode` 값.
 * - `default`: 변경 시마다 사용자에게 확인. 가장 안전.
 * - `acceptEdits`: 파일 편집은 자동 승인. (자동 모드)
 * - `bypassPermissions`: 모든 권한 확인을 건너뜀. 가장 위험.
 */
export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions";

/**
 * 사용자 환경 설정. 로컬 설치별로 다른 값을 가질 수 있어 settings 파일에 저장한다.
 * 모든 필드는 optional — 미지정 시 기본값 사용.
 */
export type AppSettings = {
  /** `claude` 실행 파일의 절대 경로. 비우면 셸 PATH에서 `claude`를 찾는다. */
  claudeBinaryPath?: string;
  /** 새 세션을 띄울 때 사용할 macOS 터미널 앱. 기본 Terminal. */
  terminalApp?: TerminalApp;
  /**
   * 새 세션 실행 시 자동으로 입력할 시작 프롬프트.
   * 호출 시 명시적으로 다른 프롬프트를 지정하면 그 값이 우선한다.
   */
  defaultPrompt?: string;
  /** true면 새 세션을 tmux 안에서 띄운다. tmux 미설치 시 빈 셸 fallback. */
  useTmux?: boolean;
  /** Claude Code 실행 시 사용할 권한 모드. 기본은 default. */
  permissionMode?: PermissionMode;
  /**
   * 자동 티켓 워커가 동시에 실행할 수 있는 최대 세션 수. 1~5 권장.
   * 기본 1 — 한 번에 한 티켓씩 직렬 처리.
   */
  maxConcurrentTickets?: number;
  /**
   * IN_PROGRESS인 티켓이 N분 이상 갱신 없으면 자동으로 REVIEW(pendingApproval=true)로 회수.
   * 기본 30분. 0 또는 음수면 watchdog 비활성.
   */
  ticketWatchdogMinutes?: number;
};

const SETTINGS_PATH = path.resolve(
  process.cwd(),
  ".app-settings.json",
);

/** 기본값. */
export const DEFAULT_SETTINGS: Required<AppSettings> = {
  claudeBinaryPath: "",
  terminalApp: "Terminal",
  defaultPrompt: "",
  useTmux: false,
  permissionMode: "default",
  maxConcurrentTickets: 1,
  ticketWatchdogMinutes: 30,
};

/**
 * 설정 파일을 읽는다. 파일이 없거나 손상됐으면 빈 객체로 폴백.
 */
export async function readAppSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as AppSettings;
  } catch {
    // 미존재/JSON 오류는 빈 설정으로 처리.
  }
  return {};
}

/** 설정을 디스크에 직렬화. partial이 아니라 전체를 덮어쓴다. */
export async function writeAppSettings(next: AppSettings): Promise<void> {
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(next, null, 2), "utf8");
}

/** 기본값과 병합한 effective 설정. */
export async function effectiveSettings(): Promise<Required<AppSettings>> {
  const stored = await readAppSettings();
  return {
    claudeBinaryPath: stored.claudeBinaryPath?.trim()
      ? stored.claudeBinaryPath.trim()
      : DEFAULT_SETTINGS.claudeBinaryPath,
    terminalApp:
      stored.terminalApp === "iTerm" || stored.terminalApp === "Ghostty"
        ? stored.terminalApp
        : DEFAULT_SETTINGS.terminalApp,
    defaultPrompt: stored.defaultPrompt ?? DEFAULT_SETTINGS.defaultPrompt,
    useTmux: stored.useTmux === true,
    permissionMode:
      stored.permissionMode === "acceptEdits" ||
      stored.permissionMode === "bypassPermissions"
        ? stored.permissionMode
        : DEFAULT_SETTINGS.permissionMode,
    maxConcurrentTickets: clampInt(
      stored.maxConcurrentTickets,
      1,
      5,
      DEFAULT_SETTINGS.maxConcurrentTickets,
    ),
    ticketWatchdogMinutes:
      typeof stored.ticketWatchdogMinutes === "number"
        ? stored.ticketWatchdogMinutes
        : DEFAULT_SETTINGS.ticketWatchdogMinutes,
  };
}

function clampInt(
  v: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  const i = Math.round(v);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}
