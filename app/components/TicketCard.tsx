"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, ExternalLink, GripVertical, Trash2 } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import type { Ticket, TicketStatus } from "@/lib/types";
import type { BadgeVariant } from "./ui";
import { Badge, Button, cn, inputBaseClass, Modal } from "./ui";
import { SessionMarkdown } from "./SessionMarkdown";
import { PRIORITY_VARIANT } from "./ticket-meta";
import { useProjects } from "./use-projects";
import { useTransitionPulse } from "./use-transition-pulse";

/**
 * 티켓의 워커/검토 상태를 한 줄 라벨로 요약. 카드 뱃지 노출용.
 * 우선순위: 차단 > 질문 대기 > 승인 대기 > 워커 실행 중 > 큐 대기 > null.
 */
function workerStateLabel(
  ticket: Ticket,
): { label: string; variant: BadgeVariant } | null {
  if (ticket.pendingQuestion) return { label: "질문 대기", variant: "warning" };
  if (ticket.pendingApproval) return { label: "승인 대기", variant: "warning" };
  if (ticket.autoSchedule === false && ticket.status === "OPEN") {
    return { label: "스케줄 비활성", variant: "default" };
  }
  if (ticket.status === "IN_PROGRESS" && ticket.currentSessionId) {
    return { label: "워커 실행", variant: "success" };
  }
  if (ticket.status === "OPEN" && ticket.projectId) {
    return { label: "큐 대기", variant: "info" };
  }
  return null;
}

/** 전이 직후 강조용 ring 클래스. 새 상태에 맞는 의미 색을 1.5초 동안 표시. */
const PULSE_RING: Record<TicketStatus, string> = {
  OPEN: "ring-2 ring-zinc-400 dark:ring-zinc-500",
  IN_PROGRESS: "ring-2 ring-sky-500 dark:ring-sky-400",
  REVIEW: "ring-2 ring-amber-500 dark:ring-amber-400",
  DONE: "ring-2 ring-emerald-500 dark:ring-emerald-400",
  CANCELLED: "ring-2 ring-red-500 dark:ring-red-400",
};

/** TicketCard와 내부 TicketActions가 공유하는 Props. */
export type TicketCardProps = {
  /** 표시할 티켓. 부모 캐시에서 내려준다. */
  ticket: Ticket;
  /** 상태 전이 액션 클릭 시 호출. */
  onTransition: (id: string, next: TicketStatus) => void;
  /** REVIEW 카드의 답변 전송. 호출자가 mutation/토스트를 담당. */
  onAnswer: (id: string, text: string) => void;
  /** 카드 본문(액션 영역 제외) 클릭 시 호출. 보드가 ?ticket=<id>로 라우팅. */
  onOpen: (id: string) => void;
  /** OPEN 카드의 "복제" 버튼 클릭 시 호출. 보드가 prefill된 새 티켓 다이얼로그를 연다. */
  onDuplicate: (ticket: Ticket) => void;
  /** "삭제" 버튼 클릭 시 호출. 보드가 ConfirmDialog → useDeleteTicket으로 처리. */
  onDelete: (ticket: Ticket) => void;
};

/**
 * 보드 컬럼 안의 티켓 한 장. 상태별 액션 버튼을 같이 그린다.
 * 캐시 갱신과 알림은 호출자(보드)의 도메인 훅이 담당 — 이 컴포넌트는 콜백만.
 */
export function TicketCard({
  ticket,
  onTransition,
  onAnswer,
  onOpen,
  onDuplicate,
  onDelete,
}: TicketCardProps) {
  const { projects } = useProjects();
  const projectName = ticket.projectId
    ? (projects.find((p) => p.id === ticket.projectId)?.name ?? ticket.projectId)
    : null;

  const pulse = useTransitionPulse(ticket.id);
  const runtime = workerStateLabel(ticket);
  const criteriaTotal = ticket.acceptance_criteria.length;
  const criteriaChecked = ticket.acceptance_criteria.filter(
    (c) => c.checked,
  ).length;
  const criteriaAllDone =
    criteriaTotal > 0 && criteriaChecked === criteriaTotal;

  const { setNodeRef, attributes, listeners, isDragging, transform } =
    useDraggable({ id: ticket.id });
  const dragStyle = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 50 as const,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={dragStyle}
      className={cn(
        "rounded-md border border-zinc-200 bg-white shadow-sm transition-shadow dark:border-zinc-800 dark:bg-zinc-950",
        isDragging && "opacity-60",
        pulse && `${PULSE_RING[ticket.status]} animate-pulse`,
      )}
    >
      <div className="flex items-start gap-1 px-2 pt-2">
        <button
          type="button"
          aria-label={`${ticket.id} 드래그`}
          {...attributes}
          {...listeners}
          className="mt-1 cursor-grab touch-none rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 active:cursor-grabbing dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => onOpen(ticket.id)}
          aria-label={`${ticket.id} 상세 열기`}
          className="block min-w-0 flex-1 rounded-md px-1 py-1 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
        >
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {ticket.title}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-zinc-500 dark:text-zinc-500">
            {ticket.id}
          </div>

        <div className="mt-2 flex flex-wrap gap-1">
          {projectName && <Badge variant="info">{projectName}</Badge>}
          {ticket.agent && <Badge variant="default">{ticket.agent}</Badge>}
          {ticket.blocked && <Badge variant="danger">차단됨</Badge>}
          {runtime && <Badge variant={runtime.variant}>{runtime.label}</Badge>}
          {criteriaTotal > 0 && (
            <Badge variant={criteriaAllDone ? "success" : "default"}>
              ✓ {criteriaChecked}/{criteriaTotal}
            </Badge>
          )}
        </div>

        {ticket.blocked && ticket.blockedReason && (
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
            {ticket.blockedReason}
          </p>
        )}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant={PRIORITY_VARIANT[ticket.priority]}>
            {ticket.priority}
          </Badge>
          {ticket.currentSessionId && (
            <Link
              href={`/sessions/${ticket.currentSessionId}`}
              target="_blank"
              aria-label={`${ticket.id} 세션 보기`}
              title="워커 세션 자세히 보기"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-sky-50 hover:text-sky-600 dark:text-zinc-400 dark:hover:bg-sky-950 dark:hover:text-sky-300"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}
          <button
            type="button"
            onClick={() => onDelete(ticket)}
            aria-label={`${ticket.id} 삭제`}
            title="삭제"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-950 dark:hover:text-red-300"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>

      <div className="flex items-end justify-between gap-2 pb-3 pl-9 pr-3">
        <div className="min-w-0 flex-1">
          <TicketActions
            ticket={ticket}
            onTransition={onTransition}
            onAnswer={onAnswer}
            onDuplicate={onDuplicate}
          />
        </div>
      </div>
    </div>
  );
}

function TicketActions({
  ticket,
  onTransition,
  onAnswer,
  onDuplicate,
}: Pick<
  TicketCardProps,
  "ticket" | "onTransition" | "onAnswer" | "onDuplicate"
>) {
  if (ticket.status === "OPEN") {
    return (
      <div className="mt-3 flex flex-wrap gap-1">
        <Button
          size="sm"
          onClick={() => onTransition(ticket.id, "IN_PROGRESS")}
        >
          시작
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onDuplicate(ticket)}
        >
          <Copy className="h-3.5 w-3.5" aria-hidden />
          <span>복제</span>
        </Button>
      </div>
    );
  }
  if (ticket.status === "IN_PROGRESS") {
    // 액션 버튼 없음 — 상태 전이는 드래그(REVIEW 컬럼) 또는 워커 자동 처리.
    return null;
  }
  if (ticket.status === "REVIEW") {
    return (
      <ReviewControls
        ticket={ticket}
        onAnswer={onAnswer}
        onTransition={onTransition}
      />
    );
  }
  return null;
}

/**
 * REVIEW 상태 통합 컨트롤.
 * - pendingQuestion이 있을 때: 카드에는 "확인 필요" 버튼만 보이고, 클릭 시 모달에서 질문 + 답변 입력.
 *   질문이 길면(스킬 출력 등) 카드를 압도하지 않게 하려는 의도.
 * - pendingQuestion이 없을 때: textarea + 승인 + 반려를 인라인 노출 (간결한 일반 REVIEW).
 *
 * 동작:
 * - 승인: 빈 입력으로 DONE 전이 (acceptance_criteria 모두 checked여야 서버가 허용)
 * - 반려/응답: textarea 내용을 answer endpoint로 보내고 같은 세션을 resume
 *   (pendingQuestion 응답이든, REVIEW 반려든 동일 경로 — 서버가 prefix로 의미 구분)
 */
function ReviewControls({
  ticket,
  onAnswer,
  onTransition,
}: Pick<TicketCardProps, "ticket" | "onAnswer" | "onTransition">) {
  const [sent, setSent] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const isQuestion = Boolean(ticket.pendingQuestion);
  const approveLabel = ticket.pendingApproval ? "DONE으로 승인" : "승인";

  const handleSend = (payload: string) => {
    onAnswer(ticket.id, payload);
    setSent(true);
    setModalOpen(false);
  };
  const handleApprove = () => {
    onTransition(ticket.id, "DONE");
    setModalOpen(false);
  };

  if (sent) {
    return (
      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        메시지 전송됨 · 워커 응답 대기 중…
      </div>
    );
  }

  if (isQuestion) {
    return (
      <>
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <span className="font-medium">워커가 확인을 요청했습니다.</span>
          <Button size="sm" variant="primary" onClick={() => setModalOpen(true)}>
            확인 / 답변
          </Button>
        </div>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="워커 질문에 답변"
          size="lg"
        >
          <div className="mb-4 max-h-[40vh] overflow-y-auto rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
            <SessionMarkdown text={ticket.pendingQuestion ?? ""} />
          </div>
          <ReviewForm
            mode="question"
            approveLabel={approveLabel}
            onSend={handleSend}
            onApprove={handleApprove}
          />
        </Modal>
      </>
    );
  }

  // Happy path — 워커가 작업을 마치고 승인 대기 중 + 모든 acceptance_criteria 충족.
  // 사용자가 "그냥 승인하면 되는데 뭘 적어야 하나?" 혼란하지 않도록 승인을 시각 우선으로,
  // 수정 요청은 토글 뒤로 숨긴다.
  const allCriteriaDone =
    ticket.acceptance_criteria.length > 0 &&
    ticket.acceptance_criteria.every((c) => c.checked);
  if (ticket.pendingApproval && allCriteriaDone) {
    return (
      <ApprovalReadyControls
        approveLabel={approveLabel}
        onApprove={handleApprove}
        onSend={handleSend}
      />
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 dark:border-amber-900 dark:bg-amber-950/40">
      <ReviewForm
        mode="reject"
        approveLabel={approveLabel}
        onSend={handleSend}
        onApprove={handleApprove}
      />
    </div>
  );
}

/**
 * 승인 가능 상태(pendingApproval + 모든 기준 충족) 전용 컨트롤.
 * 기본 표시는 "승인 가능" 안내 + 큰 승인 버튼만. 수정 요청은 작은 토글로 숨겨두고
 * 펼쳐야 textarea + 반려 버튼이 나온다 — happy path를 시각 중심으로.
 */
function ApprovalReadyControls({
  approveLabel,
  onApprove,
  onSend,
}: {
  /** 승인 버튼 라벨 — 보통 "DONE으로 승인". */
  approveLabel: string;
  /** 승인 클릭. */
  onApprove: () => void;
  /** 반려 본문 전송. "[반려] " prefix는 호출자가 붙인다. */
  onSend: (payload: string) => void;
}) {
  const [showReject, setShowReject] = useState(false);
  const [text, setText] = useState("");
  const trimmed = text.trim();

  const submitReject = () => {
    if (!trimmed) return;
    onSend(`[반려] ${trimmed}`);
    setText("");
    setShowReject(false);
  };

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 dark:border-emerald-900 dark:bg-emerald-950/30">
      <div className="flex items-center justify-between gap-2 text-xs text-emerald-800 dark:text-emerald-200">
        <span className="font-medium">✓ 모든 검토 항목 충족 — 승인 가능</span>
        <Button size="sm" variant="primary" onClick={onApprove}>
          {approveLabel}
        </Button>
      </div>
      {showReject ? (
        <div className="flex flex-col gap-2">
          <textarea
            className={inputBaseClass}
            rows={3}
            placeholder="수정 요청 내용을 입력하면 같은 세션에서 워커가 이어서 작업합니다"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowReject(false);
                setText("");
              }}
            >
              취소
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={!trimmed}
              onClick={submitReject}
            >
              반려 (수정 요청)
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowReject(true)}
          className="self-end text-[11px] text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300"
        >
          수정 요청이 있나요?
        </button>
      )}
    </div>
  );
}

/**
 * REVIEW 답변 폼. 카드 인라인과 모달에서 공유.
 */
function ReviewForm({
  mode,
  approveLabel,
  onSend,
  onApprove,
}: {
  /** "question": 워커 질문에 답변 / "reject": REVIEW 결과 반려. 버튼/플레이스홀더 라벨이 다르다. */
  mode: "question" | "reject";
  /** 승인 버튼 라벨. pendingApproval에 따라 "DONE으로 승인" / "승인". */
  approveLabel: string;
  /** 전송 버튼 클릭 시 호출. mode=reject면 "[반려] " prefix가 자동 붙는다. */
  onSend: (payload: string) => void;
  /** 승인 버튼 클릭. */
  onApprove: () => void;
}) {
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const sendLabel = mode === "question" ? "답변 보내기" : "반려 (수정 요청)";

  const submit = () => {
    if (!trimmed) return;
    const payload = mode === "question" ? trimmed : `[반려] ${trimmed}`;
    onSend(payload);
    setText("");
  };

  return (
    <div className="flex flex-col gap-2">
      <textarea
        className={inputBaseClass}
        rows={mode === "question" ? 5 : 3}
        placeholder={
          mode === "question"
            ? "워커 질문에 답변을 입력하세요"
            : "수정 요청 내용을 입력하면 같은 세션에서 워커가 이어서 작업합니다"
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={onApprove}>
          {approveLabel}
        </Button>
        <Button size="sm" variant="danger" disabled={!trimmed} onClick={submit}>
          {sendLabel}
        </Button>
      </div>
    </div>
  );
}
