"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { Project } from "@/lib/types";
import { ConfirmDialog, cn } from "./ui";
import { useDeleteProject } from "./use-projects";
import { AddProjectButton } from "./AddProjectButton";
import { EditProjectButton } from "./EditProjectButton";

type ProjectTabsProps = {
  /** 표시할 프로젝트 목록 (ALL 포함). */
  projects: Project[];
  /** 현재 활성 프로젝트 id. */
  activeId: string;
  /** 탭 클릭 시 호출. */
  onSelect: (id: string) => void;
};

export function ProjectTabs({
  projects,
  activeId,
  onSelect,
}: ProjectTabsProps) {
  const { remove, isPending } = useDeleteProject();
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);

  function confirmDelete() {
    if (!pendingDelete) return;
    remove(pendingDelete.id, {
      onSuccess: () => {
        if (activeId === pendingDelete.id) onSelect("ALL");
        setPendingDelete(null);
      },
      onError: () => setPendingDelete(null),
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 pb-2 dark:border-zinc-800">
      {projects.map((project) => (
        <ProjectTab
          key={project.id}
          project={project}
          active={project.id === activeId}
          onSelect={() => onSelect(project.id)}
          onRequestDelete={
            project.id === "ALL" ? undefined : () => setPendingDelete(project)
          }
        />
      ))}
      <AddProjectButton onCreated={(p) => onSelect(p.id)} />
      <ConfirmDialog
        open={pendingDelete !== null}
        title="프로젝트 삭제"
        message={
          pendingDelete ? (
            <div className="flex flex-col gap-2">
              <div>
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {pendingDelete.name}
                </span>{" "}
                탭을 삭제합니다.
              </div>
              <ul className="list-disc pl-5 text-zinc-600 dark:text-zinc-400">
                <li>해당 프로젝트 탭과 대시보드 표시 정보가 사라집니다.</li>
                <li>실제 .claude 디렉토리와 세션 파일은 그대로 유지됩니다.</li>
              </ul>
              <div className="text-zinc-500">계속하시겠습니까?</div>
            </div>
          ) : null
        }
        confirmLabel={isPending ? "삭제 중…" : "삭제"}
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

type ProjectTabProps = {
  /** 탭으로 표시할 프로젝트. */
  project: Project;
  /** 활성 여부. */
  active: boolean;
  /** 탭 본문 클릭. */
  onSelect: () => void;
  /** X 버튼 클릭. ALL은 미지정으로 X 숨김. */
  onRequestDelete?: () => void;
};

function ProjectTab({
  project,
  active,
  onSelect,
  onRequestDelete,
}: ProjectTabProps) {
  return (
    <div
      className={cn(
        "group relative flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm transition-colors",
        active
          ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
          : "border-zinc-200 text-zinc-700 hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-900",
      )}
    >
      {/*
        탭 박스 전체가 select 클릭 영역.
        - cover button은 inset-0으로 영역 전체를 덮음.
        - 텍스트(span)는 pointer-events-none — 시각만, 클릭은 통과시켜 cover로.
        - 편집/삭제 버튼은 pointer-events-auto + z-10으로 cover 위에 올려 자기 클릭만 받음.
      */}
      <button
        type="button"
        onClick={onSelect}
        aria-label={`${project.name} 선택`}
        className="absolute inset-0 cursor-pointer rounded-md"
      />
      <span className="pointer-events-none truncate">{project.name}</span>
      {project.id !== "ALL" && (
        <span className="relative z-10 inline-flex">
          <EditProjectButton project={project} />
        </span>
      )}
      {onRequestDelete && (
        <button
          type="button"
          onClick={onRequestDelete}
          aria-label={`${project.name} 탭 삭제`}
          title="삭제"
          className={cn(
            "relative z-10 ml-1 inline-flex items-center justify-center rounded p-0.5 transition-colors",
            active
              ? "opacity-90 hover:bg-white/20 hover:opacity-100 dark:hover:bg-black/20"
              : "text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-950 dark:hover:text-red-300",
          )}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

export { AddProjectButton };
