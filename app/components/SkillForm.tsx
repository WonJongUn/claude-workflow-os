"use client";

import { useState } from "react";
import { Save, X } from "lucide-react";
import {
  Button,
  Field,
  LineNumberedTextarea,
  cn,
  inputBaseClass,
} from "./ui";
import {
  parseFrontmatter,
  stringifyFrontmatter,
  type FrontmatterValue,
} from "@/lib/frontmatter";
import {
  dedentCommon,
  lintRawEntry,
  validateRawEntry,
} from "@/lib/entry-validation";
import { useSaveEntry } from "./use-projects";
import { ToolMultiSelect } from "./ToolMultiSelect";

type SkillFormProps = {
  /** 대상 프로젝트 id. */
  projectId: string;
  /** 편집 모드일 때 기존 이름. 미지정이면 신규. */
  initialName?: string;
  /** 편집 모드일 때 기존 본문(프론트매터 포함). */
  initialBody?: string;
  /** 저장 성공 시 호출. */
  onClose: () => void;
  /** 표시 모드 (EntryEditor가 모달 헤더에서 제어). */
  mode: "edit" | "raw" | "preview";
  /** 모드 변경 콜백. */
  onModeChange: (m: "edit" | "raw" | "preview") => void;
};

type FormState = {
  /** 파일명 (확장자 제외). frontmatter의 `name`과 동일하게 유지. */
  name: string;
  /** 자동 호출 트리거 설명. */
  description: string;
  /** 추가 트리거 컨텍스트. */
  whenToUse: string;
  /** 인자 힌트 (오토컴플리트). */
  argumentHint: string;
  /** 모델 오버라이드. */
  model: string;
  /** 노력도. */
  effort: string;
  /** 권한 없이 사용할 수 있는 도구. */
  allowedTools: string[];
  /** 마크다운 본문. */
  body: string;
};

const MODELS = ["", "inherit", "haiku", "sonnet", "opus"] as const;
const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"] as const;

const INITIAL: FormState = {
  name: "",
  description: "",
  whenToUse: "",
  argumentHint: "",
  model: "",
  effort: "",
  allowedTools: [],
  body: "",
};

/**
 * 스킬 전용 폼. 프론트매터는 구조화된 input으로, 본문은 textarea로 분리한다.
 * 저장 시 두 부분을 합쳐 단일 마크다운 문자열로 직렬화한다.
 */
export function SkillForm({
  projectId,
  initialName,
  initialBody,
  onClose,
  mode,
}: SkillFormProps) {
  const editing = initialName !== undefined;
  /**
   * 단일 source of truth. 폼 모드는 raw를 파싱해 필드를 *파생*시키고, 필드 편집은
   * toMarkdown으로 raw를 다시 직렬화한다. 동기화 버그가 구조적으로 불가능.
   * 트레이드오프: raw의 알 수 없는 frontmatter 키는 폼 모드에서 한 번 편집하면 사라진다.
   */
  const [raw, setRaw] = useState<string>(
    () => initialBody ?? toMarkdown(fromMarkdown(initialName, undefined)),
  );
  const form = fromMarkdown(initialName, raw);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[] | null>(null);
  const { save, isPending } = useSaveEntry();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setRaw(toMarkdown({ ...form, [key]: value }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIssues(null);
    const result = validateRawEntry("skill", raw, editing ? initialName : undefined);
    if (!result.ok) {
      setIssues(result.issues);
      return;
    }
    const finalName = String(result.frontmatter.name ?? "").trim();
    if (!finalName) {
      setIssues(["frontmatter.name이 필요합니다."]);
      return;
    }
    save(
      { projectId, kind: "skill", name: finalName, body: raw },
      { onSuccess: onClose, onError: setError },
    );
  }

  if (mode === "preview") {
    return (
      <pre className="scroll-thin max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-4 font-mono text-xs leading-relaxed text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
        {raw}
      </pre>
    );
  }

  if (mode === "raw") {
    const lints = lintRawEntry(raw);
    return (
      <form onSubmit={submit} className="flex flex-col gap-3">
        {lints.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <div className="font-semibold">형식 경고:</div>
            <ul className="mt-1 list-disc pl-4">
              {lints.map((h, i) => (
                <li key={i}>
                  {h.line ? <span className="font-mono">L{h.line}: </span> : null}
                  {h.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {issues && issues.length > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            <div className="font-semibold">검증 실패:</div>
            <ul className="mt-1 list-disc pl-4">
              {issues.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}
        <Field label="raw markdown" hint="frontmatter.name이 파일명이 됨">
          <LineNumberedTextarea
            value={raw}
            onChange={(v) => setRaw(dedentCommon(v))}
            placeholder={`---\nname: data-export\ndescription: Use when exporting data\nmodel: sonnet\n---\n\n# Skill\n…`}
            className="min-h-[55vh]"
          />
        </Field>
        <div className="mt-1 flex items-center justify-end gap-2">
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
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <Field label="name" required hint="파일명. 소문자/하이픈만, .md 제외">
        <input
          className={cn(inputBaseClass, "font-mono text-xs")}
          placeholder="data-export"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          disabled={editing}
          autoFocus={!editing}
        />
      </Field>

      <Field
        label="description"
        hint="언제 이 스킬을 쓸지. Claude가 자동 호출 판단에 사용."
      >
        <textarea
          className={inputBaseClass}
          rows={2}
          placeholder="Use when the user asks to export project data to CSV or JSON."
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
        />
      </Field>

      <Field
        label="when_to_use"
        hint="추가 트리거 설명 (description에 덧붙음)"
      >
        <textarea
          className={inputBaseClass}
          rows={2}
          value={form.whenToUse}
          onChange={(e) => update("whenToUse", e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="argument-hint" hint="자동완성 힌트">
          <input
            className={inputBaseClass}
            placeholder="<file-path>"
            value={form.argumentHint}
            onChange={(e) => update("argumentHint", e.target.value)}
          />
        </Field>
        <Field label="model">
          <select
            className={inputBaseClass}
            value={form.model}
            onChange={(e) => update("model", e.target.value)}
          >
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {m || "(inherit)"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="effort">
          <select
            className={inputBaseClass}
            value={form.effort}
            onChange={(e) => update("effort", e.target.value)}
          >
            {EFFORTS.map((m) => (
              <option key={m} value={m}>
                {m || "(default)"}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="allowed-tools" hint="권한 없이 사용 가능한 도구">
        <ToolMultiSelect
          value={form.allowedTools}
          onChange={(v) => update("allowedTools", v)}
        />
      </Field>

      <Field label="body" hint="마크다운 본문. --- 펜스는 자동으로 추가됨">
        <LineNumberedTextarea
          value={form.body}
          onChange={(v) => update("body", v)}
          placeholder={`# Skill\n\n구체적인 절차/예시…`}
          className="min-h-[40vh]"
        />
      </Field>

      <div className="mt-1 flex items-center justify-end gap-2">
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
  );
}

/**
 * 기존 마크다운에서 폼 상태로 역직렬화. 미지원 프론트매터 키는 본문 앞에 보존하지 않고 무시한다.
 */
function fromMarkdown(initialName?: string, body?: string): FormState {
  if (body === undefined) return { ...INITIAL, name: initialName ?? "" };
  const { frontmatter, body: content } = parseFrontmatter(body);
  return {
    name: initialName ?? str(frontmatter.name),
    description: str(frontmatter.description),
    whenToUse: str(frontmatter.when_to_use),
    argumentHint: str(frontmatter["argument-hint"]),
    model: str(frontmatter.model),
    effort: str(frontmatter.effort),
    allowedTools: list(frontmatter["allowed-tools"]),
    body: content.replace(/^\n+/, ""),
  };
}

function toMarkdown(form: FormState): string {
  const fm: Record<string, FrontmatterValue> = {};
  fm.name = form.name.trim();
  if (form.description.trim()) fm.description = form.description.trim();
  if (form.whenToUse.trim()) fm.when_to_use = form.whenToUse.trim();
  if (form.argumentHint.trim()) fm["argument-hint"] = form.argumentHint.trim();
  if (form.model) fm.model = form.model;
  if (form.effort) fm.effort = form.effort;
  if (form.allowedTools.length > 0) fm["allowed-tools"] = form.allowedTools;
  return stringifyFrontmatter({ frontmatter: fm, body: form.body });
}

function str(v: FrontmatterValue | undefined): string {
  if (v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

function list(v: FrontmatterValue | undefined): string[] {
  if (v === undefined) return [];
  if (Array.isArray(v)) return v;
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
