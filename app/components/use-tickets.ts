"use client";

import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { Ticket, TicketEvent, TicketStatus } from "@/lib/types";
import {
  createTicket,
  fetchTickets,
  setBlocked,
  transitionTicket,
  type CreateTicketInput,
} from "./ticket-client";
import { useNotify } from "./notifications";

/**
 * 티켓 캐시 키. 외부에 노출하지 않는다 — 훅 내부 구현 세부.
 */
const TICKETS_KEY = ["tickets"] as const;

/**
 * 티켓 목록을 구독한다. 초기 로드는 HTTP, 이후 변경은 SSE로 캐시에 머지된다.
 * 컴포넌트는 react-query·SSE 존재를 알 필요가 없다.
 */
export function useTickets(): {
  /** 현재 티켓 목록. 미로드 시 빈 배열. */
  tickets: Ticket[];
  /** 초기 로드 진행 중 여부. */
  isLoading: boolean;
} {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: TICKETS_KEY,
    queryFn: fetchTickets,
  });

  useEffect(() => subscribeToTicketStream(queryClient), [queryClient]);

  return { tickets: data ?? [], isLoading };
}

/**
 * 새 티켓을 생성한다. 성공 시 캐시에 즉시 반영.
 */
export function useCreateTicket(): {
  /** 생성 트리거. 비동기 결과는 onSuccess/onError에서. */
  create: (
    input: CreateTicketInput,
    handlers?: { onSuccess?: () => void; onError?: (msg: string) => void },
  ) => void;
  /** 진행 중 여부. */
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const mutation = useMutation({
    mutationFn: (input: CreateTicketInput) => createTicket(input),
    onSuccess: (ticket) => {
      queryClient.setQueryData<Ticket[]>(TICKETS_KEY, (prev) =>
        upsertTicket(prev ?? [], ticket),
      );
      notify({ level: "success", category: "ticket",
        href: "/board", title: "티켓 생성됨", detail: ticket.title });
    },
    onError: (err) =>
      notify({ level: "error", category: "ticket",
        href: "/board", title: "티켓 생성 실패", detail: toMessage(err) }),
  });

  return {
    create: (input, handlers) =>
      mutation.mutate(input, {
        onSuccess: () => handlers?.onSuccess?.(),
        onError: (err) => handlers?.onError?.(toMessage(err)),
      }),
    isPending: mutation.isPending,
  };
}

/**
 * 티켓 상태 전이.
 */
export function useTicketTransition(): {
  /** 전이 트리거. */
  transition: (
    id: string,
    next: TicketStatus,
    handlers?: { onError?: (msg: string) => void },
  ) => void;
  /** 진행 중 여부. */
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const mutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: TicketStatus }) =>
      transitionTicket(id, next),
    onSuccess: (ticket) => {
      queryClient.setQueryData<Ticket[]>(TICKETS_KEY, (prev) =>
        upsertTicket(prev ?? [], ticket),
      );
      notify({
        level: "success",
        category: "ticket",
        href: "/board",
        title: `티켓 ${ticket.status}`,
        detail: `${ticket.id} ${ticket.title}`,
      });
    },
    onError: (err) =>
      notify({ level: "error", category: "ticket",
        href: "/board", title: "티켓 상태 전이 실패", detail: toMessage(err) }),
  });

  return {
    transition: (id, next, handlers) =>
      mutation.mutate(
        { id, next },
        { onError: (err) => handlers?.onError?.(toMessage(err)) },
      ),
    isPending: mutation.isPending,
  };
}

/**
 * 티켓 blocked 플래그 토글.
 */
export function useToggleBlocked(): {
  /** blocked 변경. reason은 blocked=true일 때만 사용. */
  toggle: (
    id: string,
    blocked: boolean,
    reason?: string,
    handlers?: { onError?: (msg: string) => void },
  ) => void;
  /** 진행 중 여부. */
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const mutation = useMutation({
    mutationFn: ({
      id,
      blocked,
      reason,
    }: {
      id: string;
      blocked: boolean;
      reason?: string;
    }) => setBlocked(id, blocked, reason),
    onSuccess: (ticket) => {
      queryClient.setQueryData<Ticket[]>(TICKETS_KEY, (prev) =>
        upsertTicket(prev ?? [], ticket),
      );
      notify({
        level: ticket.blocked ? "info" : "success",
        category: "ticket",
        href: "/board",
        title: ticket.blocked ? "티켓 차단됨" : "티켓 차단 해제",
        detail: ticket.id,
      });
    },
    onError: (err) =>
      notify({ level: "error", category: "ticket",
        href: "/board", title: "차단 토글 실패", detail: toMessage(err) }),
  });

  return {
    toggle: (id, blocked, reason, handlers) =>
      mutation.mutate(
        { id, blocked, reason },
        { onError: (err) => handlers?.onError?.(toMessage(err)) },
      ),
    isPending: mutation.isPending,
  };
}

type SsePayload = { type: "snapshot"; tickets: Ticket[] } | TicketEvent;

/**
 * SSE 스트림에 연결하고 티켓 캐시를 갱신한다. unmount 시 닫는다.
 */
function subscribeToTicketStream(queryClient: QueryClient): () => void {
  const es = new EventSource("/api/sse");
  es.addEventListener("message", (ev) => {
    try {
      const data = JSON.parse(ev.data) as SsePayload;
      queryClient.setQueryData<Ticket[]>(TICKETS_KEY, (prev) =>
        applySseEvent(prev ?? [], data),
      );
    } catch (err) {
      console.warn("[useTickets] sse parse failed", err);
    }
  });
  return () => es.close();
}

function applySseEvent(prev: Ticket[], data: SsePayload): Ticket[] {
  switch (data.type) {
    case "snapshot":
      return data.tickets;
    case "ticket.created":
      return upsertTicket(prev, data.ticket);
    case "ticket.updated":
      return prev.map((t) => (t.id === data.ticket.id ? data.ticket : t));
    case "ticket.deleted":
      return prev.filter((t) => t.id !== data.id);
  }
}

function upsertTicket(prev: Ticket[], next: Ticket): Ticket[] {
  return prev.some((t) => t.id === next.id)
    ? prev.map((t) => (t.id === next.id ? next : t))
    : [...prev, next];
}

function toMessage(err: unknown): string {
  type MaybeAxios = { isAxiosError?: boolean; response?: { data?: unknown } };
  const candidate = err as MaybeAxios;
  if (candidate?.isAxiosError) {
    const data = candidate.response?.data;
    if (data && typeof data === "object" && "error" in data) {
      const msg = (data as { error?: unknown }).error;
      if (typeof msg === "string" && msg.length > 0) return msg;
    }
  }
  return err instanceof Error ? err.message : String(err);
}
