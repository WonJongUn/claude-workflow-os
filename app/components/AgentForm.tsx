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

type AgentFormProps = {
  /** 대상 프로젝트 id. */
  projectId: string;
  /** 편집 모드일 때 기존 이름. */
  initialName?: string;
  /** 편집 모드일 때 기존 본문. */
  initialBody?: string;
  /** 저장 성공/취소 시 호출. */
  onClose: () => void;
  /** 표시 모드 (EntryEditor가 모달 헤더에서 제어). */
  mode: "edit" | "raw" | "preview";
  /** 모드 변경 콜백 (preview에서 "폼으로 돌아가기" 같은 내부 전환용). */
  onModeChange: (m: "edit" | "raw" | "preview") => void;
};

type FormState = {
  /** 파일명 (확장자 제외). */
  name: string;
  /** 에이전트 설명. */
  description: string;
  /** 모델 오버라이드. */
  model: string;
  /** 사용 가능한 도구 목록. 비우면 전체 허용. */
  tools: string[];
  /** UI 식별 색 (선택). */
  color: string;
  /** 본문(시스템 프롬프트). */
  body: string;
};

const MODELS = ["", "inherit", "haiku", "sonnet", "opus"] as const;

const INITIAL: FormState = {
  name: "",
  description: "",
  model: "",
  tools: [],
  color: "",
  body: "",
};

/**
 * 에이전트 전용 폼. 프론트매터(name/description/model/tools/color)는 구조화 입력으로,
 * 시스템 프롬프트 본문은 별도 textarea로 분리한다.
 */
export function AgentForm({
  projectId,
  initialName,
  initialBody,
  onClose,
  mode,
}: AgentFormProps) {
  const editing = initialName !== undefined;
  /**
   * 단일 source of truth. 폼 모드는 raw를 파싱해 필드를 *파생*시켜 보여주고,
   * 필드 편집은 toMarkdown으로 raw를 다시 직렬화한다. raw 모드는 textarea로 직접 raw를 편집.
   * 어느 모드에서 편집하든 결과는 한 변수에 모이므로 동기화 버그가 구조적으로 불가능.
   *
   * 트레이드오프: raw에 있던 알 수 없는 frontmatter 키는 폼 모드에서 한 번 편집하면 사라진다.
   * (toMarkdown은 정의된 필드만 다시 쓰기 때문) — raw에서만 작업하면 보존됨.
   */
  const [raw, setRaw] = useState<string>(
    () => initialBody ?? toMarkdown(fromMarkdown(initialName, undefined)),
  );
  const form = fromMarkdown(initialName, raw);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[] | null>(null);
  const { save, isPending } = useSaveEntry();

  /** 폼 필드 1개 갱신 → raw 재직렬화. */
  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setRaw(toMarkdown({ ...form, [key]: value }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIssues(null);
    // 저장은 항상 raw(= form ↔ raw 동기화 결과)를 기준으로 검증한다.
    // 편집 모드는 이름 변경을 막기 위해 initialName을 expectedName으로 넘긴다.
    // 신규는 frontmatter.name이 곧 파일명.
    const result = validateRawEntry("agent", raw, editing ? initialName : undefined);
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
      { projectId, kind: "agent", name: finalName, body: raw },
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
            placeholder={`---\nname: api-dev\ndescription: API backend changes\nmodel: sonnet\ntools: [Read, Edit]\n---\n\n# 역할\n…`}
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
          placeholder="api-dev"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          disabled={editing}
          autoFocus={!editing}
        />
      </Field>

      <Field
        label="description"
        hint="에이전트가 무엇을 하는지. Claude가 라우팅 판단에 사용."
        required
      >
        <textarea
          className={inputBaseClass}
          rows={2}
          placeholder="API 백엔드 변경/추가 작업 전담."
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
        <Field label="color" hint="UI 식별용 (선택)">
          <input
            className={inputBaseClass}
            placeholder="blue / red / #6366f1"
            value={form.color}
            onChange={(e) => update("color", e.target.value)}
          />
        </Field>
      </div>

      <Field label="tools" hint="비우면 전체 도구 허용">
        <ToolMultiSelect
          value={form.tools}
          onChange={(v) => update("tools", v)}
        />
      </Field>

      <Field
        label="body"
        hint="시스템 프롬프트 (마크다운). --- 펜스는 자동 추가됨"
      >
        <LineNumberedTextarea
          value={form.body}
          onChange={(v) => update("body", v)}
          placeholder={`# 역할\n…\n\n# 절차\n…`}
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

function fromMarkdown(initialName?: string, body?: string): FormState {
  if (body === undefined) return { ...INITIAL, name: initialName ?? "" };
  const { frontmatter, body: content } = parseFrontmatter(body);
  return {
    name: initialName ?? str(frontmatter.name),
    description: str(frontmatter.description),
    model: str(frontmatter.model),
    tools: list(frontmatter.tools),
    color: str(frontmatter.color),
    body: content.replace(/^\n+/, ""),
  };
}

function toMarkdown(form: FormState): string {
  const fm: Record<string, FrontmatterValue> = {};
  fm.name = form.name.trim();
  if (form.description.trim()) fm.description = form.description.trim();
  if (form.model) fm.model = form.model;
  if (form.tools.length > 0) fm.tools = form.tools;
  if (form.color.trim()) fm.color = form.color.trim();
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
