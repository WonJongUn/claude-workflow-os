"use client";

import type { Ticket, TicketStatus } from "@/lib/types";
import { Badge, Button } from "./ui";
import { PRIORITY_VARIANT } from "./ticket-meta";

/** TicketCard와 내부 TicketActions가 공유하는 Props. */
export type TicketCardProps = {
  /** 표시할 티켓. 부모 캐시에서 내려준다. */
  ticket: Ticket;
  /** 상태 전이 액션 클릭 시 호출. */
  onTransition: (id: string, next: TicketStatus) => void;
  /** blocked 토글 액션 클릭 시 호출. reason 입력은 호출자 책임. */
  onToggleBlocked: (ticket: Ticket) => void;
};

/**
 * 보드 컬럼 안의 티켓 한 장. 상태별 액션 버튼을 같이 그린다.
 * 캐시 갱신과 알림은 호출자(보드)의 도메인 훅이 담당 — 이 컴포넌트는 콜백만.
 */
export function TicketCard({
  ticket,
  onTransition,
  onToggleBlocked,
}: TicketCardProps) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {ticket.title}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-zinc-500 dark:text-zinc-500">
            {ticket.id}
          </div>
        </div>
        <Badge variant={PRIORITY_VARIANT[ticket.priority]}>
          {ticket.priority}
        </Badge>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {ticket.agent && <Badge variant="default">{ticket.agent}</Badge>}
        {ticket.blocked && <Badge variant="danger">차단됨</Badge>}
      </div>

      {ticket.blocked && ticket.blockedReason && (
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          {ticket.blockedReason}
        </p>
      )}

      <TicketActions
        ticket={ticket}
        onTransition={onTransition}
        onToggleBlocked={onToggleBlocked}
      />
    </div>
  );
}

function TicketActions({
  ticket,
  onTransition,
  onToggleBlocked,
}: TicketCardProps) {
  if (ticket.status === "OPEN") {
    return (
      <div className="mt-3 flex flex-wrap gap-1">
        <Button
          size="sm"
          onClick={() => onTransition(ticket.id, "IN_PROGRESS")}
        >
          시작
        </Button>
      </div>
    );
  }
  if (ticket.status === "IN_PROGRESS") {
    return (
      <div className="mt-3 flex flex-wrap gap-1">
        <Button size="sm" onClick={() => onTransition(ticket.id, "REVIEW")}>
          검토 요청
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onToggleBlocked(ticket)}
        >
          {ticket.blocked ? "차단 해제" : "차단 표시"}
        </Button>
      </div>
    );
  }
  if (ticket.status === "REVIEW") {
    return (
      <div className="mt-3 flex flex-wrap gap-1">
        <Button size="sm" onClick={() => onTransition(ticket.id, "DONE")}>
          승인
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => onTransition(ticket.id, "IN_PROGRESS")}
        >
          반려
        </Button>
      </div>
    );
  }
  return null;
}
