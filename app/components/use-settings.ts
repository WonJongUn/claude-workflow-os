"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type { AppSettings } from "@/lib/app-settings";
import { useNotify } from "./notifications";

const SETTINGS_KEY = ["settings"] as const;
const api = axios.create({
  baseURL: "/api",
  headers: { "content-type": "application/json" },
});

async function fetchSettings(): Promise<AppSettings> {
  const { data } = await api.get<AppSettings>("/settings");
  return data;
}

async function patchSettings(input: AppSettings): Promise<AppSettings> {
  const { data } = await api.patch<AppSettings>("/settings", input);
  return data;
}

/**
 * 앱 설정 구독.
 */
export function useSettings(): {
  settings: AppSettings;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: fetchSettings,
  });
  return { settings: data ?? {}, isLoading };
}

/**
 * 앱 설정 저장.
 */
export function useSaveSettings(): {
  save: (
    input: AppSettings,
    handlers?: { onSuccess?: () => void; onError?: (msg: string) => void },
  ) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const mutation = useMutation({
    mutationFn: patchSettings,
    onSuccess: (next) => {
      queryClient.setQueryData<AppSettings>(SETTINGS_KEY, next);
      notify({
        level: "success",
        category: "settings",
        href: "/settings",
        title: "설정 저장됨",
        detail: summarizeSettings(next),
      });
    },
    onError: (err) =>
      notify({ level: "error", category: "settings",
        href: "/settings", title: "설정 저장 실패", detail: toMessage(err) }),
  });
  return {
    save: (input, handlers) =>
      mutation.mutate(input, {
        onSuccess: () => handlers?.onSuccess?.(),
        onError: (err) => handlers?.onError?.(toMessage(err)),
      }),
    isPending: mutation.isPending,
  };
}

/** 토스트 detail 용 한 줄 요약. 비어있는 필드는 "기본값". */
function summarizeSettings(s: AppSettings): string {
  const claude = s.claudeBinaryPath?.trim()
    ? s.claudeBinaryPath.trim()
    : "기본값(PATH)";
  const terminal = s.terminalApp ?? "Terminal";
  const promptLen = s.defaultPrompt?.trim().length ?? 0;
  const prompt = promptLen > 0 ? `${promptLen}자` : "없음";
  const mode = s.permissionMode ?? "default";
  const modeLabel =
    mode === "acceptEdits"
      ? "자동"
      : mode === "bypassPermissions"
        ? "권한 무시"
        : "기본";
  return `Claude: ${claude} · 터미널: ${terminal} · 권한: ${modeLabel} · 기본 프롬프트: ${prompt}`;
}

function toMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data;
    if (data && typeof data === "object" && "error" in data) {
      const msg = (data as { error?: unknown }).error;
      if (typeof msg === "string" && msg.length > 0) return msg;
    }
  }
  return err instanceof Error ? err.message : String(err);
}
