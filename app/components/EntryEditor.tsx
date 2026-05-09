"use client";

import { useState } from "react";
import { Code2, Eye, Pencil, Save, X } from "lucide-react";
import {
  Button,
  Field,
  LineNumberedTextarea,
  Modal,
  cn,
  inputBaseClass,
} from "./ui";
import type { EntryKind } from "./project-client";
import { useSaveEntry } from "./use-projects";
import { AgentForm } from "./AgentForm";
import { SkillForm } from "./SkillForm";

/** AgentForm/SkillForm이 공유하는 편집 모드. EntryEditor가 끌어올려 헤더에 노출한다. */
export type EntryEditMode = "edit" | "raw" | "preview";

type EntryEditorProps = {
  /** 모달 표시 여부. */
  open: boolean;
  /** 닫기 콜백. */
  onClose: () => void;
  /** 대상 프로젝트 id. */
  projectId: string;
  /** 종류. */
  kind: EntryKind;
  /** 편집 모드일 때 기존 이름. 없으면 신규. */
  initialName?: string;
  /** 편집 모드일 때 기존 본문. */
  initialBody?: string;
};

const KIND_LABEL: Record<EntryKind, string> = {
  agent: "에이전트",
  skill: "스킬",
};

/**
 * 에이전트/스킬 .md 파일 생성·수정 모달. 수정 모드에서는 이름이 잠긴다.
 */
export function EntryEditor({
  open,
  onClose,
  projectId,
  kind,
  initialName,
  initialBody,
}: EntryEditorProps) {
  const editing = initialName !== undefined;
  const [name, setName] = useState(initialName ?? "");
  const [body, setBody] = useState(initialBody ?? "");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<EntryEditMode>("edit");
  const { save, isPending } = useSaveEntry();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("이름은 필수입니다.");
      return;
    }
    save(
      { projectId, kind, name: name.trim(), body },
      {
        onSuccess: onClose,
        onError: setError,
      },
    );
  }

  const title = editing
    ? `${KIND_LABEL[kind]} 수정 — ${initialName}`
    : `새 ${KIND_LABEL[kind]}`;

  if (kind === "skill" || kind === "agent") {
    const FormComp = kind === "skill" ? SkillForm : AgentForm;
    return (
      <Modal
        open={open}
        onClose={onClose}
        title={title}
        size="xl"
        headerActions={<ModeToggle mode={mode} onChange={setMode} />}
      >
        <FormComp
          projectId={projectId}
          initialName={initialName}
          initialBody={initialBody}
          onClose={onClose}
          mode={mode}
          onModeChange={setMode}
        />
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="xl">
      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="이름" required hint=".md 확장자 제외">
          <input
            className={cn(inputBaseClass, "font-mono text-xs")}
            placeholder="my-entry"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={editing}
            autoFocus={!editing}
          />
        </Field>
        <Field label="본문 (마크다운)">
          <LineNumberedTextarea
            value={body}
            onChange={setBody}
            placeholder={`---\nname: ...\ndescription: ...\n---\n\n# ...`}
            className="min-h-[40vh]"
          />
        </Field>
        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
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
  );
}

/**
 * 폼 / Raw YAML / 미리보기 토글. Modal 헤더 우측에 배치.
 */
function ModeToggle({
  mode,
  onChange,
}: {
  mode: EntryEditMode;
  onChange: (m: EntryEditMode) => void;
}) {
  const opts: { id: EntryEditMode; icon: typeof Pencil; label: string }[] = [
    { id: "edit", icon: Pencil, label: "폼" },
    { id: "raw", icon: Code2, label: "Raw" },
    { id: "preview", icon: Eye, label: "미리보기" },
  ];
  return (
    <div className="inline-flex rounded-md border border-zinc-200 bg-white p-0.5 text-xs dark:border-zinc-800 dark:bg-zinc-950">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-label={o.label}
          title={o.label}
          className={cn(
            "inline-flex items-center gap-1 rounded px-2 py-0.5 transition-colors",
            mode === o.id
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
          )}
        >
          <o.icon className="h-3 w-3" aria-hidden />
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
