"use client";

import { useMemo, useState } from "react";
import type { Ticket, TicketStatus } from "@/lib/types";
import { Card, CardBody, CardHeader, CardTitle } from "./ui";
import { BOARD_COLUMNS, STATUS_LABEL } from "./ticket-meta";
import { TicketColumn } from "./TicketColumn";
import {
  useTicketTransition,
  useTickets,
  useToggleBlocked,
} from "./use-tickets";

/**
 * 4-column 칸반보드. 데이터·변경은 도메인 훅으로 위임한다.
 * 컴포넌트는 react-query/SSE/HTTP를 알지 않는다.
 */
export function TicketBoard() {
  const [error, setError] = useState<string | null>(null);
  const { tickets } = useTickets();
  const { transition } = useTicketTransition();
  const { toggle: toggleBlocked } = useToggleBlocked();

  const grouped = useMemo(() => groupByStatus(tickets), [tickets]);

  function onTransition(id: string, next: TicketStatus) {
    transition(id, next, { onError: setError });
  }

  function onToggleBlocked(ticket: Ticket) {
    if (ticket.blocked) {
      toggleBlocked(ticket.id, false, undefined, { onError: setError });
      return;
    }
    const reason = window.prompt("차단 사유를 입력하세요.") ?? "";
    toggleBlocked(ticket.id, true, reason, { onError: setError });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>티켓</CardTitle>
      </CardHeader>
      <CardBody>
        {error && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          {BOARD_COLUMNS.map((status) => (
            <TicketColumn
              key={status}
              title={STATUS_LABEL[status]}
              tickets={grouped[status]}
              onTransition={onTransition}
              onToggleBlocked={onToggleBlocked}
            />
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function groupByStatus(tickets: Ticket[]): Record<TicketStatus, Ticket[]> {
  const map: Record<TicketStatus, Ticket[]> = {
    OPEN: [],
    IN_PROGRESS: [],
    REVIEW: [],
    DONE: [],
    CANCELLED: [],
  };
  for (const t of tickets) map[t.status].push(t);
  return map;
}
