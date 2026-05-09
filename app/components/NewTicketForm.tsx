"use client";

import { useState } from "react";
import { FilePlus2, X } from "lucide-react";
import type { TicketPriority } from "@/lib/types";
import {
  Button,
  Field,
  StringListInput,
  inputBaseClass,
} from "./ui";
import { AgentSelect } from "./AgentSelect";
import { ReferencesInput } from "./ReferencesInput";
import type { CreateTicketInput } from "./ticket-client";
import { useCreateTicket } from "./use-tickets";
import { useProjects } from "./use-projects";

type NewTicketFormProps = {
  /** 생성 완료(성공) 또는 취소 시 닫기. */
  onClose: () => void;
  /** 폼 레벨 에러 메시지 표시. */
  onError: (msg: string | null) => void;
};

type FormState = {
  /** 한 줄 요약. */
  title: string;
  /** 담당 에이전트 슬러그. */
  agent: string;
  /** 무엇을 할지. */
  goal: string;
  /** 맥락. */
  background: string;
  /** 우선순위. */
  priority: TicketPriority;
  /** 요구사항. */
  requirements: string[];
  /** 완료 기준. */
  acceptance_criteria: string[];
  /** 참조 파일/URL. */
  references: string[];
};

const INITIAL: FormState = {
  title: "",
  agent: "",
  goal: "",
  background: "",
  priority: "medium",
  requirements: [],
  acceptance_criteria: [],
  references: [],
};

/**
 * 새 티켓 생성 폼. 활성 프로젝트의 에이전트 목록을 함께 가져와 select에 채운다.
 * 성공 시 onClose 호출, 실패 시 onError로 메시지 전달 (모달에서 표시).
 */
export function NewTicketForm({ onClose, onError }: NewTicketFormProps) {
  const [form, setForm] = useState<FormState>(INITIAL);
  const { create, isPending } = useCreateTicket();
  const { activeId } = useProjects();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((s) => ({ ...s, [key]: value }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.goal.trim()) {
      onError("제목과 목표는 필수입니다.");
      return;
    }
    create(toInput(form), {
      onSuccess: () => {
        onError(null);
        setForm(INITIAL);
        onClose();
      },
      onError,
    });
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Field label="제목" required className="md:col-span-2">
        <input
          className={inputBaseClass}
          placeholder="POST /users 엔드포인트 구현"
          value={form.title}
          onChange={(e) => update("title", e.target.value)}
          autoFocus
        />
      </Field>

      <Field label="담당 에이전트" hint="프로젝트 또는 글로벌 에이전트">
        <AgentSelect
          value={form.agent}
          onChange={(v) => update("agent", v)}
          projectId={activeId}
        />
      </Field>

      <Field label="우선순위">
        <select
          className={inputBaseClass}
          value={form.priority}
          onChange={(e) => update("priority", e.target.value as TicketPriority)}
        >
          <option value="low">낮음</option>
          <option value="medium">보통</option>
          <option value="high">높음</option>
        </select>
      </Field>

      <Field label="목표" required className="md:col-span-2">
        <textarea
          className={inputBaseClass}
          rows={3}
          placeholder="신규 사용자 생성 API를 구현한다."
          value={form.goal}
          onChange={(e) => update("goal", e.target.value)}
        />
      </Field>

      <Field label="배경" hint="현재 상태/맥락" className="md:col-span-2">
        <textarea
          className={inputBaseClass}
          rows={2}
          placeholder="현재 GET /users만 있고 생성 기능이 없어 …"
          value={form.background}
          onChange={(e) => update("background", e.target.value)}
        />
      </Field>

      <Field label="요구사항" className="md:col-span-2">
        <StringListInput
          value={form.requirements}
          onChange={(v) => update("requirements", v)}
          placeholder="요구사항을 입력하고 Enter"
        />
      </Field>

      <Field label="완료 기준" className="md:col-span-2">
        <StringListInput
          value={form.acceptance_criteria}
          onChange={(v) => update("acceptance_criteria", v)}
          placeholder="완료 기준을 입력하고 Enter"
        />
      </Field>

      <Field
        label="참조"
        hint="@로 활성 프로젝트의 파일 검색"
        className="md:col-span-2"
      >
        <ReferencesInput
          value={form.references}
          onChange={(v) => update("references", v)}
          projectId={activeId}
        />
      </Field>

      <div className="flex justify-end gap-2 md:col-span-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <X className="h-3.5 w-3.5" aria-hidden />
          <span>취소</span>
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          <FilePlus2 className="h-3.5 w-3.5" aria-hidden />
          <span>{isPending ? "생성 중…" : "티켓 생성"}</span>
        </Button>
      </div>
    </form>
  );
}

function toInput(form: FormState): CreateTicketInput {
  return {
    title: form.title.trim(),
    goal: form.goal.trim(),
    priority: form.priority,
    agent: form.agent.trim() || undefined,
    background: form.background.trim() || undefined,
    requirements: trimList(form.requirements),
    acceptance_criteria: trimList(form.acceptance_criteria),
    references:
      form.references.length > 0 ? trimList(form.references) : undefined,
  };
}

function trimList(items: string[]): string[] {
  return items.map((s) => s.trim()).filter((s) => s.length > 0);
}
