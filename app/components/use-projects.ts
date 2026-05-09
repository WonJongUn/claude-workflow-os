"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import axios from "axios";
import type { ClaudeContext, Project } from "@/lib/types";
import {
  createProject,
  deleteEntry,
  deleteProject,
  fetchContext,
  fetchProjects,
  saveEntry,
  updateProject,
  type EntryKind,
} from "./project-client";
import { useNotify } from "./notifications";

const PROJECTS_KEY = ["projects"] as const;
const ALL_ID = "ALL";

/**
 * 프로젝트 목록 + 활성 프로젝트 id를 함께 관리한다.
 * 활성 id는 URL `?project=`가 단일 진실 원천. 공유/북마크/뒤로가기와 일관.
 * 미존재 id가 들어오면 자연스럽게 ALL로 표시 (URL은 그대로 두어 사용자가 의도를 잃지 않게).
 */
export function useProjects(): {
  /** 등록된 프로젝트들. 첫 항목은 항상 ALL. */
  projects: Project[];
  /** 활성 프로젝트 id. */
  activeId: string;
  /** 활성 프로젝트 변경. URL ?project=만 갱신. */
  setActive: (id: string) => void;
  /** 초기 로드 진행 중. */
  isLoading: boolean;
} {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data, isLoading } = useQuery({
    queryKey: PROJECTS_KEY,
    queryFn: fetchProjects,
  });
  const projects = useMemo(() => data ?? [], [data]);
  const rawId = searchParams.get("project") ?? ALL_ID;
  // 알려진 id가 아니면 ALL로 폴백 (URL은 손대지 않고 표시만 ALL).
  const activeId =
    projects.length === 0 || projects.some((p) => p.id === rawId)
      ? rawId
      : ALL_ID;
  const setActive = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id === ALL_ID) params.delete("project");
      else params.set("project", id);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return { projects, activeId, setActive, isLoading };
}

/**
 * 새 프로젝트 등록.
 */
export function useCreateProject(): {
  create: (
    input: { name: string; claudeRoot: string },
    handlers?: { onSuccess?: (p: Project) => void; onError?: (msg: string) => void },
  ) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const mutation = useMutation({
    mutationFn: createProject,
    onSuccess: (project) => {
      queryClient.setQueryData<Project[]>(PROJECTS_KEY, (prev) =>
        prev ? [...prev, project] : [project],
      );
      notify({ level: "success", category: "project",
        href: "/settings", title: "프로젝트 생성됨", detail: project.name });
    },
    onError: (err) =>
      notify({ level: "error", category: "project",
        href: "/settings", title: "프로젝트 생성 실패", detail: toMessage(err) }),
  });
  return {
    create: (input, handlers) =>
      mutation.mutate(input, {
        onSuccess: (project) => handlers?.onSuccess?.(project),
        onError: (err) => handlers?.onError?.(toMessage(err)),
      }),
    isPending: mutation.isPending,
  };
}

/**
 * 프로젝트 일부 필드 갱신. (이름, workDir 등)
 */
export function useUpdateProject(): {
  update: (
    id: string,
    patch: { name?: string; workDir?: string },
    handlers?: { onSuccess?: (p: Project) => void; onError?: (msg: string) => void },
  ) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const mutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; workDir?: string } }) =>
      updateProject(id, patch),
    onSuccess: (project) => {
      queryClient.setQueryData<Project[]>(PROJECTS_KEY, (prev) =>
        (prev ?? []).map((p) => (p.id === project.id ? project : p)),
      );
      queryClient.invalidateQueries({ queryKey: ["sessions", project.id] });
      notify({ level: "success", category: "project",
        href: "/settings", title: "프로젝트 갱신됨", detail: project.name });
    },
    onError: (err) =>
      notify({ level: "error", category: "project",
        href: "/settings", title: "프로젝트 갱신 실패", detail: toMessage(err) }),
  });
  return {
    update: (id, patch, handlers) =>
      mutation.mutate(
        { id, patch },
        {
          onSuccess: (project) => handlers?.onSuccess?.(project),
          onError: (err) => handlers?.onError?.(toMessage(err)),
        },
      ),
    isPending: mutation.isPending,
  };
}

/**
 * 프로젝트 삭제. ALL은 서버가 거부한다.
 */
export function useDeleteProject(): {
  remove: (
    id: string,
    handlers?: { onSuccess?: () => void; onError?: (msg: string) => void },
  ) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const mutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: (_void, id) => {
      const prev = queryClient.getQueryData<Project[]>(PROJECTS_KEY) ?? [];
      const removed = prev.find((p) => p.id === id);
      queryClient.setQueryData<Project[]>(PROJECTS_KEY, prev.filter((p) => p.id !== id));
      notify({
        level: "success",
        category: "project",
        href: "/settings",
        title: "프로젝트 삭제됨",
        detail: removed?.name,
      });
    },
    onError: (err) =>
      notify({ level: "error", category: "project",
        href: "/settings", title: "프로젝트 삭제 실패", detail: toMessage(err) }),
  });
  return {
    remove: (id, handlers) =>
      mutation.mutate(id, {
        onSuccess: () => handlers?.onSuccess?.(),
        onError: (err) => handlers?.onError?.(toMessage(err)),
      }),
    isPending: mutation.isPending,
  };
}

/**
 * 활성 프로젝트의 .claude 컨텍스트 구독.
 * 외부 편집(타 도구·CLI)을 빠르게 반영하도록 5초 폴링 + 탭 포커스 시 갱신.
 */
export function useProjectContext(projectId: string): {
  context: ClaudeContext | undefined;
  isLoading: boolean;
  /** 즉시 다시 가져오기. 새로고침 버튼에서 호출. */
  refetch: () => void;
  /** 갱신 진행 중 여부. */
  isFetching: boolean;
  /** 마지막 성공 fetch 시각 (epoch ms). 0이면 아직 없음. */
  dataUpdatedAt: number;
} {
  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["context", projectId],
    queryFn: () => fetchContext(projectId),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  return {
    context: data,
    isLoading,
    isFetching,
    refetch: () => void refetch(),
    dataUpdatedAt,
  };
}

/**
 * 에이전트/스킬 파일 저장 (생성 또는 수정). 성공 시 컨텍스트 캐시 무효화.
 */
export function useSaveEntry(): {
  save: (
    input: { projectId: string; kind: EntryKind; name: string; body: string },
    handlers?: { onSuccess?: () => void; onError?: (msg: string) => void },
  ) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const mutation = useMutation({
    mutationFn: saveEntry,
    onSuccess: (_void, vars) => {
      queryClient.invalidateQueries({ queryKey: ["context", vars.projectId] });
      notify({
        level: "success",
        category: "project",
        href: "/settings",
        title: `${vars.kind === "agent" ? "에이전트" : "스킬"} 저장됨`,
        detail: vars.name,
      });
    },
    onError: (err, vars) =>
      notify({
        level: "error",
        category: "project",
        href: "/settings",
        title: `${vars.kind === "agent" ? "에이전트" : "스킬"} 저장 실패`,
        detail: toMessage(err),
      }),
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

/**
 * 에이전트/스킬 파일 삭제. 성공 시 컨텍스트 캐시 무효화.
 */
export function useDeleteEntry(): {
  remove: (
    input: { projectId: string; kind: EntryKind; name: string },
    handlers?: { onSuccess?: () => void; onError?: (msg: string) => void },
  ) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const mutation = useMutation({
    mutationFn: deleteEntry,
    onSuccess: (_void, vars) => {
      queryClient.invalidateQueries({ queryKey: ["context", vars.projectId] });
      notify({
        level: "success",
        category: "project",
        href: "/settings",
        title: `${vars.kind === "agent" ? "에이전트" : "스킬"} 삭제됨`,
        detail: vars.name,
      });
    },
    onError: (err) =>
      notify({ level: "error", category: "project",
        href: "/settings", title: "삭제 실패", detail: toMessage(err) }),
  });
  return {
    remove: (input, handlers) =>
      mutation.mutate(input, {
        onSuccess: () => handlers?.onSuccess?.(),
        onError: (err) => handlers?.onError?.(toMessage(err)),
      }),
    isPending: mutation.isPending,
  };
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
