"use client";

import type { Ticket, TicketStatus } from "@/lib/types";
import { Column, EmptyState } from "./ui";
import { TicketCard } from "./TicketCard";

type TicketColumnProps = {
  /** 컬럼 헤더에 표시할 라벨. */
  title: string;
  /** 이 컬럼에 들어갈 티켓들. 호출자가 그룹핑 책임. */
  tickets: Ticket[];
  /** 티켓 상태 전이 액션. */
  onTransition: (id: string, next: TicketStatus) => void;
  /** blocked 토글 액션. */
  onToggleBlocked: (ticket: Ticket) => void;
};

export function TicketColumn({
  title,
  tickets,
  onTransition,
  onToggleBlocked,
}: TicketColumnProps) {
  return (
    <Column title={title} count={tickets.length}>
      {tickets.length === 0 ? (
        <EmptyState>비어 있음</EmptyState>
      ) : (
        tickets.map((t) => (
          <TicketCard
            key={t.id}
            ticket={t}
            onTransition={onTransition}
            onToggleBlocked={onToggleBlocked}
          />
        ))
      )}
    </Column>
  );
}
