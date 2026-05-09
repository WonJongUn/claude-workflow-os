"use client";

import { useState, type ReactNode } from "react";
import { CheckCircle2, Save, XCircle } from "lucide-react";
import { Button, Field, cn, inputBaseClass } from "./ui";
import type {
  AppSettings,
  PermissionMode,
  TerminalApp,
} from "@/lib/app-settings";
import { useSaveSettings, useSettings } from "./use-settings";
import { useSystemCheck } from "./use-system-check";

const TERMINAL_OPTIONS: TerminalApp[] = ["Terminal", "iTerm", "Ghostty"];

const PERMISSION_OPTIONS: {
  value: PermissionMode;
  label: string;
  description: string;
}[] = [
  {
    value: "default",
    label: "기본",
    description: "변경마다 사용자에게 확인. 가장 안전.",
  },
  {
    value: "acceptEdits",
    label: "자동 모드",
    description: "파일 편집을 자동 승인. 권한이 필요한 다른 작업은 확인.",
  },
  {
    value: "bypassPermissions",
    label: "권한 무시",
    description: "모든 권한 확인을 건너뜁니다. 위험.",
  },
];

function resolvePermissionMode(
  value: AppSettings["permissionMode"],
): PermissionMode {
  if (value === "acceptEdits" || value === "bypassPermissions") return value;
  return "default";
}

/** 저장된 설정에서 폼 초기 상태로 변환. 알 수 없는 terminalApp은 Terminal로 폴백. */
function resolveTerminalApp(value: AppSettings["terminalApp"]): TerminalApp {
  if (TERMINAL_OPTIONS.includes(value as TerminalApp)) return value as TerminalApp;
  return "Terminal";
}

/**
 * 앱 전역 설정 편집 폼. 라우트 페이지(`/settings`)에서 호스팅된다.
 * 페이지 자체가 컨테이너 역할이라 별도 카드 없이 섹션 + divider로 구분.
 */
export function SettingsForm() {
  const { settings, isLoading } = useSettings();
  if (isLoading) return <SettingsSkeleton />;
  return <SettingsFormInner initial={settings} />;
}

function SettingsFormInner({ initial }: { initial: AppSettings }) {
  const { save, isPending } = useSaveSettings();
  const { check } = useSystemCheck();
  const [claudeBinaryPath, setClaudeBinaryPath] = useState(
    initial.claudeBinaryPath ?? "",
  );
  const [terminalApp, setTerminalApp] = useState<TerminalApp>(
    resolveTerminalApp(initial.terminalApp),
  );
  const [defaultPrompt, setDefaultPrompt] = useState(initial.defaultPrompt ?? "");
  const [useTmux, setUseTmux] = useState(initial.useTmux === true);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    resolvePermissionMode(initial.permissionMode),
  );

  const initialPath = initial.claudeBinaryPath ?? "";
  const initialTerminal = resolveTerminalApp(initial.terminalApp);
  const initialPrompt = initial.defaultPrompt ?? "";
  const initialUseTmux = initial.useTmux === true;
  const initialPermissionMode = resolvePermissionMode(initial.permissionMode);
  const isDirty =
    claudeBinaryPath.trim() !== initialPath.trim() ||
    terminalApp !== initialTerminal ||
    defaultPrompt !== initialPrompt ||
    useTmux !== initialUseTmux ||
    permissionMode !== initialPermissionMode;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isDirty) return;
    save({
      claudeBinaryPath: claudeBinaryPath.trim(),
      terminalApp,
      defaultPrompt,
      useTmux,
      permissionMode,
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col">
      <SettingsSection
        title="Claude"
        description="새 세션 실행에 사용할 `claude` CLI."
      >
        <Field
          label="실행 경로"
          hint="비우면 셸 PATH의 `claude`를 사용합니다."
        >
          <input
            className={cn(inputBaseClass, "font-mono text-xs")}
            placeholder={check?.claudePath ?? "/usr/local/bin/claude"}
            value={claudeBinaryPath}
            onChange={(e) => setClaudeBinaryPath(e.target.value)}
          />
        </Field>
        <InstallStatus
          label={claudeBinaryPath.trim() ? "지정 경로" : "PATH의 claude"}
          installed={check?.claude}
          missingHint="실행 파일이 없습니다. 경로를 확인하거나 `claude` CLI를 설치하세요."
        />
      </SettingsSection>

      <SettingsSection
        title="터미널 앱"
        description="`생성` 버튼을 눌렀을 때 새 창을 띄울 macOS 앱."
      >
        <div className="flex gap-2">
          {TERMINAL_OPTIONS.map((opt) => {
            const installed = check?.terminals[opt] ?? true;
            const selected = terminalApp === opt;
            return (
              <button
                key={opt}
                type="button"
                disabled={!installed}
                onClick={() => installed && setTerminalApp(opt)}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 rounded-md border px-3 py-2 text-sm transition-colors",
                  !installed &&
                    "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-600",
                  installed && selected
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : installed &&
                        "border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900",
                )}
              >
                <span>{opt}</span>
                <span
                  className={cn(
                    "text-[10px]",
                    installed
                      ? selected
                        ? "opacity-80"
                        : "text-zinc-500"
                      : "text-zinc-400 dark:text-zinc-600",
                  )}
                >
                  {check
                    ? installed
                      ? "설치됨"
                      : "설치 필요"
                    : "확인 중…"}
                </span>
              </button>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection
        title="tmux"
        description="활성화하면 새 세션을 tmux 안에서 띄웁니다. 기존 세션 이름이 있으면 attach."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={useTmux}
            disabled={check ? !check.tmux : false}
            onChange={(e) => setUseTmux(e.target.checked)}
            className="h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
          />
          <span
            className={cn(
              check && !check.tmux && "text-zinc-400 dark:text-zinc-600",
            )}
          >
            tmux 안에서 실행
          </span>
        </label>
        <InstallStatus
          label="tmux"
          installed={check?.tmux}
          missingHint="`brew install tmux` 또는 패키지 매니저로 설치 후 다시 시도하세요."
        />
      </SettingsSection>

      <SettingsSection
        title="권한 모드"
        description="`claude --permission-mode` 인자로 전달됩니다."
      >
        <div className="flex flex-col gap-2">
          {PERMISSION_OPTIONS.map((opt) => {
            const selected = permissionMode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPermissionMode(opt.value)}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                  selected
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900",
                )}
              >
                <span className="font-medium">{opt.label}</span>
                <span
                  className={cn(
                    "text-[11px]",
                    selected ? "opacity-80" : "text-zinc-500",
                  )}
                >
                  {opt.description}
                </span>
              </button>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection
        title="기본 프롬프트"
        description="새 세션 실행 시 자동 입력할 시작 프롬프트. `프롬프트로 생성`에서 추가 입력하면 줄바꿈으로 이어붙어 전송됩니다."
      >
        <Field label="시작 프롬프트" hint="비우면 빈 세션으로 시작합니다.">
          <textarea
            className={cn(inputBaseClass, "min-h-24 font-mono text-xs")}
            placeholder="예: 이 저장소 구조를 빠르게 정리해줘."
            value={defaultPrompt}
            onChange={(e) => setDefaultPrompt(e.target.value)}
          />
        </Field>
      </SettingsSection>

      <div className="flex justify-end border-t border-zinc-200 py-4 dark:border-zinc-800">
        <Button type="submit" size="sm" disabled={isPending || !isDirty}>
          <Save className="h-3.5 w-3.5" aria-hidden />
          <span>{isPending ? "저장 중…" : "저장"}</span>
        </Button>
      </div>
    </form>
  );
}

/**
 * 외부 도구 설치 상태 인디케이터. 미설치 시 빨간 X + 안내 문구.
 * undefined(확인 중)은 회색.
 */
function InstallStatus({
  label,
  installed,
  missingHint,
}: {
  /** 어떤 도구를 검사 중인지. */
  label: string;
  /** true=설치됨, false=미설치, undefined=확인 중. */
  installed: boolean | undefined;
  /** 미설치일 때 보조 안내. */
  missingHint?: string;
}) {
  if (installed === undefined) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
        <span className="h-2 w-2 animate-pulse rounded-full bg-zinc-300 dark:bg-zinc-700" />
        {label} 확인 중…
      </div>
    );
  }
  if (installed) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        <span>{label} 설치 확인됨</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
        <XCircle className="h-3.5 w-3.5" aria-hidden />
        <span>{label} 미설치</span>
      </div>
      {missingHint && (
        <span className="text-zinc-500">{missingHint}</span>
      )}
    </div>
  );
}

/** 초기 fetch 동안 보여줄 회색 자리표시자. */
function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-4 py-6">
      <div className="h-4 w-32 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-9 w-full animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-9 w-full animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}

/**
 * 설정 페이지의 한 섹션. 좌측에 제목·설명, 우측에 입력 필드.
 * macOS 시스템 설정/Linear/Vercel 같은 두 컬럼 레이아웃.
 */
function SettingsSection({
  title,
  description,
  children,
}: {
  /** 섹션 제목. */
  title: string;
  /** 섹션 보조 설명. */
  description?: string;
  /** 우측 입력 필드들. */
  children: ReactNode;
}) {
  return (
    <section className="grid grid-cols-1 gap-4 border-t border-zinc-200 py-6 first:border-t-0 first:pt-0 md:grid-cols-[14rem_1fr] md:gap-8 dark:border-zinc-800">
      <header className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </h2>
        {description && (
          <p className="text-xs text-zinc-500">{description}</p>
        )}
      </header>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}
