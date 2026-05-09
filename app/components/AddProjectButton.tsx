"use client";

import { useState } from "react";
import { FolderOpen, FolderPlus, X } from "lucide-react";
import type { Project } from "@/lib/types";
import {
  Button,
  Field,
  Modal,
  cn,
  inputBaseClass,
} from "./ui";
import { DirectoryPicker } from "./DirectoryPicker";
import { useCreateProject } from "./use-projects";

type AddProjectButtonProps = {
  /** 생성 성공 시 호출. 호출자는 보통 새 프로젝트를 활성화한다. */
  onCreated: (project: Project) => void;
};

export function AddProjectButton({ onCreated }: AddProjectButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [claudeRoot, setClaudeRoot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { create, isPending } = useCreateProject();

  function close() {
    setOpen(false);
    setError(null);
    setName("");
    setClaudeRoot("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !claudeRoot.trim()) {
      setError("이름과 .claude 경로는 필수입니다.");
      return;
    }
    create(
      { name: name.trim(), claudeRoot: claudeRoot.trim() },
      {
        onSuccess: (project) => {
          onCreated(project);
          close();
        },
        onError: setError,
      },
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-100"
      >
        <FolderPlus className="h-4 w-4" aria-hidden />
        프로젝트 추가
      </button>
      <Modal open={open} onClose={close} title="프로젝트 추가" size="md">
        <div className="mb-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200">
          <p className="font-medium">등록 가이드</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sky-700 dark:text-sky-300">
            <li>
              <span className="font-semibold">.claude 폴더가 있는 디렉토리</span>를
              지정하세요. 그 폴더 안의 CLAUDE.md / agents / skills / settings.json이
              컨텍스트에 표시됩니다.
            </li>
            <li>
              세션 목록은 <span className="font-semibold">이 디렉토리에서 또는 그
              하위에서</span> 시작한 Claude Code 세션만 표시됩니다. 다른 위치에서 시작한
              세션은 잡히지 않습니다.
            </li>
          </ul>
        </div>
        {error && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="이름" required>
            <input
              className={inputBaseClass}
              placeholder="my-app"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>
          <Field
            label="프로젝트 디렉토리"
            required
            hint=".claude 폴더가 들어있는 절대 경로. 보통 프로젝트 루트."
          >
            <div className="flex items-center gap-2">
              <input
                className={cn(inputBaseClass, "flex-1 font-mono text-xs")}
                placeholder="/Users/.../my-app/.claude"
                value={claudeRoot}
                onChange={(e) => setClaudeRoot(e.target.value)}
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
            onSelect={(p) => setClaudeRoot(p)}
            initialPath={claudeRoot || undefined}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={close}>
              <X className="h-3.5 w-3.5" aria-hidden />
              <span>취소</span>
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              <FolderPlus className="h-3.5 w-3.5" aria-hidden />
              <span>{isPending ? "추가 중…" : "추가"}</span>
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
