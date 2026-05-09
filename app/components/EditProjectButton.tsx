"use client";

import { useState } from "react";
import { FolderOpen, Pencil, Save, X } from "lucide-react";
import type { Project } from "@/lib/types";
import { Button, Field, Modal, cn, inputBaseClass } from "./ui";
import { DirectoryPicker } from "./DirectoryPicker";
import { useUpdateProject } from "./use-projects";

type EditProjectButtonProps = {
  /** 편집할 프로젝트. */
  project: Project;
};

/**
 * 프로젝트 탭 옆의 작은 연필 아이콘. 누르면 이름·workDir을 편집한다.
 */
export function EditProjectButton({ project }: EditProjectButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [workDir, setWorkDir] = useState(project.workDir ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { update, isPending } = useUpdateProject();

  function close() {
    setOpen(false);
    setError(null);
    setName(project.name);
    setWorkDir(project.workDir ?? "");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    update(
      project.id,
      { name, workDir },
      { onSuccess: () => close(), onError: setError },
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={`${project.name} 편집`}
        title="편집"
        className="rounded p-0.5 text-current opacity-90 hover:bg-black/15 hover:opacity-100 dark:hover:bg-white/15"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden />
      </button>
      <Modal open={open} onClose={close} title="프로젝트 편집" size="md">
        {error && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="이름" required>
            <input
              className={inputBaseClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field
            label=".claude 경로"
            hint="컨텍스트 로딩에 사용. 변경하려면 재등록 필요."
          >
            <input
              className={cn(inputBaseClass, "font-mono text-xs")}
              value={project.claudeRoot}
              disabled
            />
          </Field>
          <Field
            label="작업 디렉토리 (workDir)"
            hint="세션 매칭 기준 경로. 비우면 .claude의 부모를 사용."
          >
            <div className="flex items-center gap-2">
              <input
                className={cn(inputBaseClass, "flex-1 font-mono text-xs")}
                placeholder="/Users/…/agentic-os"
                value={workDir}
                onChange={(e) => setWorkDir(e.target.value)}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setPickerOpen(true)}
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden />
                <span>폴더 찾아보기</span>
              </Button>
            </div>
          </Field>
          <DirectoryPicker
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            onSelect={(p) => setWorkDir(p)}
            initialPath={workDir || project.claudeRoot}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={close}>
              <X className="h-3.5 w-3.5" aria-hidden />
              <span>취소</span>
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              <Save className="h-3.5 w-3.5" aria-hidden />
              <span>{isPending ? "저장 중…" : "저장"}</span>
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
