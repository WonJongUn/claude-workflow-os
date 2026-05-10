"use client";

import { useDroppable } from "@dnd-kit/core";
import type { Ticket, TicketStatus } from "@/lib/types";
import { cn, Column, EmptyState } from "./ui";
import { TicketCard } from "./TicketCard";

type TicketColumnProps = {
  /** 컬럼 헤더에 표시할 라벨. */
  title: string;
  /**
   * 드롭 타깃 고유 id. 섹션 key + status 조합 (`section:status`)으로 보드가 만들어 내려준다.
   * 같은 status라도 프로젝트 섹션이 다르면 별개 droppable이라 hover ring이 정확히 한 컬럼에만 뜬다.
   * 보드는 이 id에서 status를 파싱해 전이를 호출.
   */
  droppableId: string;
  /** 이 컬럼에 들어갈 티켓들. 호출자가 그룹핑 책임. */
  tickets: Ticket[];
  /** 티켓 상태 전이 액션. */
  onTransition: (id: string, next: TicketStatus) => void;
  /** REVIEW 카드의 답변 전송. */
  onAnswer: (id: string, text: string) => void;
  /** 카드 본문 클릭 시 호출 (상세 모달 열기). */
  onOpen: (id: string) => void;
  /** OPEN 카드의 복제 버튼. */
  onDuplicate: (ticket: Ticket) => void;
  /** 카드의 삭제 버튼. */
  onDelete: (ticket: Ticket) => void;
};

/**
 * 한 상태에 해당하는 티켓들을 한 컬럼으로 모아 그린다.
 * dnd-kit 드롭 타깃 — `status`를 droppable id로 사용해 드래그 종료 시 보드가 전이를 호출.
 */
export function TicketColumn({
  title,
  droppableId,
  tickets,
  onTransition,
  onAnswer,
  onOpen,
  onDuplicate,
  onDelete,
}: TicketColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-md transition-colors",
        isOver && "ring-2 ring-zinc-300 dark:ring-zinc-700",
      )}
    >
      <Column title={title} count={tickets.length}>
        {tickets.length === 0 ? (
          <EmptyState>비어 있음</EmptyState>
        ) : (
          tickets.map((t) => (
            <TicketCard
              key={t.id}
              ticket={t}
              onTransition={onTransition}
              onAnswer={onAnswer}
              onOpen={onOpen}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
            />
          ))
        )}
      </Column>
    </div>
  );
}
