"use client";

import { useState } from "react";
import { FilePlus2, Save, X } from "lucide-react";
import type { AcceptanceCriterion, TicketPriority } from "@/lib/types";
import {
  Button,
  Field,
  StringListInput,
  inputBaseClass,
} from "./ui";
import { AcceptanceCriteriaInput } from "./AcceptanceCriteriaInput";
import { AgentSelect } from "./AgentSelect";
import { ReferencesInput } from "./ReferencesInput";
import type { CreateTicketInput } from "./ticket-client";
import { useCreateTicket, useUpdateTicket } from "./use-tickets";
import { useProjects } from "./use-projects";

type NewTicketFormProps = {
  /** 생성 완료(성공) 또는 취소 시 닫기. */
  onClose: () => void;
  /** 폼 레벨 에러 메시지 표시. */
  onError: (msg: string | null) => void;
  /**
   * 폼 초기값 override. 복제·편집에서 기존 티켓 내용을 채워 열 때 사용.
   * 미지정 필드는 빈/기본값. 마운트 후엔 사용자가 자유롭게 수정.
   */
  initial?: Partial<FormState>;
  /**
   * 지정 시 PATCH(편집 모드), 미지정이면 POST(생성 모드).
   * id는 변경 불가 — 폼은 본문만 수정한다.
   */
  editingId?: string;
  /**
   * true면 모든 입력을 disabled로 두고 저장 버튼을 숨긴다 — OPEN이 아닌 티켓의 상세 보기.
   * 사용자는 닫기만 할 수 있다.
   */
  readOnly?: boolean;
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
  /** 완료 기준. text + checked 구조. 모두 checked일 때만 DONE 전이 가능. */
  acceptance_criteria: AcceptanceCriterion[];
  /** 참조 파일/URL. */
  references: string[];
  /** 자동 워커가 실행할 프로젝트 id. 빈 문자열이면 미지정 (워커 픽업 안 함). */
  projectId: string;
  /** 자동 스케줄링 활성. false면 OPEN이어도 워커가 픽업하지 않는다. */
  autoSchedule: boolean;
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
  projectId: "",
  autoSchedule: true,
};

/**
 * 새 티켓 생성 폼. 활성 프로젝트의 에이전트 목록을 함께 가져와 select에 채운다.
 * 성공 시 onClose 호출, 실패 시 onError로 메시지 전달 (모달에서 표시).
 */
export function NewTicketForm({
  onClose,
  onError,
  initial,
  editingId,
  readOnly = false,
}: NewTicketFormProps) {
  const { create, isPending: isCreating } = useCreateTicket();
  const { update: patchTicket, isPending: isUpdating } = useUpdateTicket();
  const { activeId, projects } = useProjects();
  // 폼 첫 마운트 때 활성 프로젝트 탭이 사용자 프로젝트면 기본값으로 — 한 번 클릭 줄임.
  // 명시적 prefill(`initial.projectId`)이 있으면 그것이 우선.
  const [form, setForm] = useState<FormState>(() => ({
    ...INITIAL,
    projectId: activeId !== "ALL" ? activeId : "",
    ...initial,
  }));
  const isEdit = Boolean(editingId);
  const isPending = isCreating || isUpdating;
  // 자동 워커 픽업 대상은 사용자 프로젝트만 — 글로벌 ALL 탭은 제외.
  const workerProjects = projects.filter((p) => p.id !== "ALL");

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((s) => ({ ...s, [key]: value }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.goal.trim()) {
      onError("제목과 목표는 필수입니다.");
      return;
    }
    if (!form.projectId) {
      onError("프로젝트를 선택하세요.");
      return;
    }
    const payload = toInput(form);
    if (isEdit && editingId) {
      patchTicket(editingId, payload, {
        onSuccess: () => {
          onError(null);
          onClose();
        },
        onError,
      });
      return;
    }
    create(payload, {
      onSuccess: () => {
        onError(null);
        setForm(INITIAL);
        onClose();
      },
      onError,
    });
  }

  return (
    <form onSubmit={submit}>
      <fieldset
        disabled={readOnly}
        className="m-0 grid grid-cols-1 gap-3 border-0 p-0 md:grid-cols-2"
      >
      <Field label="제목" required className="md:col-span-2">
        <input
          className={inputBaseClass}
          placeholder="POST /users 엔드포인트 구현"
          value={form.title}
          onChange={(e) => updateField("title", e.target.value)}
          autoFocus
        />
      </Field>

      <Field label="담당 에이전트" hint="프로젝트 또는 글로벌 에이전트">
        <AgentSelect
          value={form.agent}
          onChange={(v) => updateField("agent", v)}
          projectId={activeId}
        />
      </Field>

      <Field label="우선순위">
        <select
          className={inputBaseClass}
          value={form.priority}
          onChange={(e) => updateField("priority", e.target.value as TicketPriority)}
        >
          <option value="low">낮음</option>
          <option value="medium">보통</option>
          <option value="high">높음</option>
        </select>
      </Field>

      <Field
        label="실행 프로젝트"
        required
        hint={
          workerProjects.length === 0
            ? "등록된 프로젝트가 없습니다. 설정에서 프로젝트를 먼저 추가하세요."
            : "선택한 프로젝트에서 자동 워커가 세션을 띄웁니다."
        }
        className="md:col-span-2"
      >
        <select
          className={inputBaseClass}
          value={form.projectId}
          onChange={(e) => updateField("projectId", e.target.value)}
          disabled={workerProjects.length === 0}
        >
          <option value="" disabled>
            프로젝트 선택…
          </option>
          {workerProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="자동 스케줄링"
        hint="활성 시 OPEN 상태에서 자동 워커가 즉시 픽업합니다. 비활성이면 사용자가 활성으로 바꿀 때까지 대기."
        className="md:col-span-2"
      >
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
            checked={form.autoSchedule}
            onChange={(e) => updateField("autoSchedule", e.target.checked)}
          />
          <span>활성</span>
        </label>
      </Field>

      <Field label="목표" required className="md:col-span-2">
        <textarea
          className={inputBaseClass}
          rows={3}
          placeholder="신규 사용자 생성 API를 구현한다."
          value={form.goal}
          onChange={(e) => updateField("goal", e.target.value)}
        />
      </Field>

      <Field label="배경" hint="현재 상태/맥락" className="md:col-span-2">
        <textarea
          className={inputBaseClass}
          rows={2}
          placeholder="현재 GET /users만 있고 생성 기능이 없어 …"
          value={form.background}
          onChange={(e) => updateField("background", e.target.value)}
        />
      </Field>

      <Field label="요구사항" className="md:col-span-2">
        <StringListInput
          value={form.requirements}
          onChange={(v) => updateField("requirements", v)}
          placeholder="요구사항을 입력하고 Enter"
        />
      </Field>

      <Field
        label="완료 기준"
        hint="모든 항목이 체크되어야 DONE으로 전이 가능 — 워커도 PATCH로 체크할 수 있습니다."
        className="md:col-span-2"
      >
        <AcceptanceCriteriaInput
          value={form.acceptance_criteria}
          onChange={(v) => updateField("acceptance_criteria", v)}
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
          onChange={(v) => updateField("references", v)}
          projectId={activeId}
        />
      </Field>

      </fieldset>
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <X className="h-3.5 w-3.5" aria-hidden />
          <span>{readOnly ? "닫기" : "취소"}</span>
        </Button>
        {!readOnly && (
          <Button type="submit" size="sm" disabled={isPending}>
            {isEdit ? (
              <Save className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <FilePlus2 className="h-3.5 w-3.5" aria-hidden />
            )}
            <span>
              {isPending
                ? isEdit
                  ? "저장 중…"
                  : "생성 중…"
                : isEdit
                  ? "저장"
                  : "티켓 생성"}
            </span>
          </Button>
        )}
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
    acceptance_criteria: form.acceptance_criteria
      .map((c) => ({ text: c.text.trim(), checked: c.checked }))
      .filter((c) => c.text.length > 0),
    references:
      form.references.length > 0 ? trimList(form.references) : undefined,
    projectId: form.projectId.trim() || undefined,
    autoSchedule: form.autoSchedule,
  };
}

function trimList(items: string[]): string[] {
  return items.map((s) => s.trim()).filter((s) => s.length > 0);
}
