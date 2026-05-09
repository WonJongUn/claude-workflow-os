"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteSessionFile,
  fetchSessions,
  launchSession,
  resumeSession,
  type SessionInfo,
} from "./project-client";
import { useNotify } from "./notifications";

/**
 * 활성 프로젝트의 Claude Code 세션 구독.
 * 신규 세션 감지가 준실시간이 되도록 5초 폴링 + 탭 포커스 시 즉시 갱신.
 */
export function useSessions(projectId: string): {
  sessions: SessionInfo[];
  isLoading: boolean;
  /** 즉시 다시 가져오기. 새로고침 버튼에서 호출. */
  refetch: () => void;
  /** 갱신 진행 중 여부. */
  isFetching: boolean;
  /** 마지막 성공 fetch 시각 (epoch ms). */
  dataUpdatedAt: number;
} {
  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["sessions", projectId],
    queryFn: () => fetchSessions(projectId),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  return {
    sessions: data ?? [],
    isLoading,
    isFetching,
    refetch: () => void refetch(),
    dataUpdatedAt,
  };
}

/**
 * 새 Claude Code 세션을 프로젝트의 workDir에서 띄운다.
 * 성공 시 토스트로 사용된 cwd를 알려주고, 잠시 뒤 ["sessions", projectId] 캐시를 무효화하여
 * 새 jsonl 파일이 목록에 등장하도록 유도.
 */
export function useLaunchSession(): {
  launch: (
    projectId: string,
    options?: { initialPrompt?: string; ignoreDefaultPrompt?: boolean },
  ) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const mutation = useMutation({
    mutationFn: (vars: {
      projectId: string;
      initialPrompt?: string;
      ignoreDefaultPrompt?: boolean;
    }) =>
      launchSession(vars.projectId, {
        initialPrompt: vars.initialPrompt,
        ignoreDefaultPrompt: vars.ignoreDefaultPrompt,
      }),
    onSuccess: ({ cwd }, vars) => {
      const title = vars.initialPrompt
        ? "프롬프트로 새 세션 실행"
        : vars.ignoreDefaultPrompt
          ? "새 세션 실행 (기본 프롬프트 무시)"
          : "새 세션 실행";
      notify({ level: "success", category: "session",
        href: "/dashboard", title, detail: cwd });
      setTimeout(() => {
        queryClient.invalidateQueries({
          queryKey: ["sessions", vars.projectId],
        });
      }, 1500);
    },
    onError: (err) =>
      notify({
        level: "error",
        category: "session",
        href: "/dashboard",
        title: "새 세션 실행 실패",
        detail: toMessage(err),
      }),
  });
  return {
    launch: (projectId, options) =>
      mutation.mutate({
        projectId,
        initialPrompt: options?.initialPrompt,
        ignoreDefaultPrompt: options?.ignoreDefaultPrompt,
      }),
    isPending: mutation.isPending,
  };
}

/**
 * 기존 세션을 `claude --resume <id>`로 이어간다. 성공/실패 시 토스트로 알린다.
 * 잠시 뒤 ["sessions"] 캐시를 무효화해 mtime이 갱신된 세션이 활성으로 보이도록.
 */
export function useResumeSession(): {
  resume: (sessionId: string) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const mutation = useMutation({
    mutationFn: (sessionId: string) => resumeSession(sessionId),
    onSuccess: ({ cwd, sessionId }) => {
      notify({
        level: "success",
        category: "session",
        href: `/sessions/${sessionId}`,
        title: "세션 이어가기",
        detail: `${sessionId.slice(0, 8)}… · ${cwd}`,
      });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["sessions"] });
      }, 1500);
    },
    onError: (err) =>
      notify({
        level: "error",
        category: "session",
        href: "/dashboard",
        title: "세션 이어가기 실패",
        detail: toMessage(err),
      }),
  });
  return {
    resume: (sessionId) => mutation.mutate(sessionId),
    isPending: mutation.isPending,
  };
}

function toMessage(err: unknown): string {
  type MaybeAxios = { isAxiosError?: boolean; response?: { data?: unknown } };
  const candidate = err as MaybeAxios;
  if (candidate?.isAxiosError) {
    const data = candidate.response?.data;
    if (data && typeof data === "object" && "error" in data) {
      const msg = (data as { error?: unknown }).error;
      if (typeof msg === "string" && msg.length > 0) return msg;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * 모든 ["sessions", *] 캐시에서 주어진 sessionId들을 함수형 갱신으로 제거.
 * 함수형 setter를 써서 동시 갱신에서도 race로 누락되지 않도록 한다.
 */
function removeFromSessionCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionIds: ReadonlySet<string>,
) {
  const caches = queryClient.getQueriesData<SessionInfo[]>({
    queryKey: ["sessions"],
  });
  for (const [key] of caches) {
    queryClient.setQueryData<SessionInfo[]>(key, (prev) =>
      prev ? prev.filter((s) => !sessionIds.has(s.id)) : prev,
    );
  }
}

/**
 * 세션 여러 개를 한 번에 삭제. 부분 실패를 허용하고, 성공/실패 합산 알림을 단일 토스트로 보낸다.
 * mutation 단위가 한 묶음이라 onSuccess/onError가 1회만 호출되어 다이얼로그 닫기·편집 모드 종료 등의 후처리가 단순해진다.
 */
export function useDeleteSessions(): {
  remove: (
    sessions: SessionInfo[],
    handlers?: {
      onSettled?: (result: { succeeded: number; failed: number }) => void;
    },
  ) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const mutation = useMutation({
    mutationFn: async (sessions: SessionInfo[]) => {
      const settled = await Promise.allSettled(
        sessions.map((s) => deleteSessionFile(s.id)),
      );
      const succeeded: SessionInfo[] = [];
      const failed: { session: SessionInfo; reason: unknown }[] = [];
      sessions.forEach((s, i) => {
        const r = settled[i];
        if (r.status === "fulfilled") succeeded.push(s);
        else failed.push({ session: s, reason: r.reason });
      });
      return { succeeded, failed };
    },
    onSuccess: ({ succeeded, failed }) => {
      if (succeeded.length > 0) {
        removeFromSessionCaches(
          queryClient,
          new Set(succeeded.map((s) => s.id)),
        );
        notify({
          level: "success",
          category: "session",
        href: "/dashboard",
          title: "세션 삭제됨",
          detail: `${succeeded.length}개를 삭제하였습니다`,
        });
      }
      if (failed.length > 0) {
        notify({
          level: "error",
          category: "session",
        href: "/dashboard",
          title: "일부 세션 삭제 실패",
          detail: `${failed.length}개 실패`,
        });
      }
    },
    onError: (err) =>
      notify({
        level: "error",
        category: "session",
        href: "/dashboard",
        title: "세션 삭제 실패",
        detail: err instanceof Error ? err.message : String(err),
      }),
  });
  return {
    remove: (sessions, handlers) =>
      mutation.mutate(sessions, {
        onSettled: (result) => {
          handlers?.onSettled?.({
            succeeded: result?.succeeded.length ?? 0,
            failed: result?.failed.length ?? 0,
          });
        },
      }),
    isPending: mutation.isPending,
  };
}
