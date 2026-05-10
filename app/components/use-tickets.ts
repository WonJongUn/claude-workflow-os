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
  answerTicket,
  createTicket,
  deleteTicket,
  fetchTickets,
  setBlocked,
  transitionTicket,
  updateTicket,
  type CreateTicketInput,
} from "./ticket-client";
import { useNotify } from "./notifications";
import type { NotificationLevel } from "./notifications";
import { STATUS_LABEL } from "./ticket-meta";
import { markTransition } from "./use-transition-pulse";
import { subscribeSse } from "./sse-bus";

/**
 * 티켓 캐시 키. 외부에 노출하지 않는다 — 훅 내부 구현 세부.
 */
const TICKETS_KEY = ["tickets"] as const;

/** 상태 전이 알림의 레벨 매핑. SSE 단일 소스 원칙. */
const STATUS_LEVEL: Record<TicketStatus, NotificationLevel> = {
  OPEN: "info",
  IN_PROGRESS: "info",
  REVIEW: "warning",
  DONE: "success",
  CANCELLED: "info",
};

/**
 * 티켓 목록을 구독한다. 초기 로드는 HTTP, 이후 변경은 SSE로 캐시에 머지된다.
 * 상태 전이 알림은 SSE에서 단일 발행 — 워커가 일으킨 자동 전이까지 일관되게 잡는다.
 * 컴포넌트는 react-query·SSE 존재를 알 필요가 없다.
 */
export function useTickets(): {
  /** 현재 티켓 목록. 미로드 시 빈 배열. */
  tickets: Ticket[];
  /** 초기 로드 진행 중 여부. */
  isLoading: boolean;
} {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const { data, isLoading } = useQuery({
    queryKey: TICKETS_KEY,
    queryFn: fetchTickets,
  });

  useEffect(
    () => subscribeToTicketStream(queryClient, notify),
    [queryClient, notify],
  );

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
 * 기존 티켓 부분 수정. 성공 알림은 SSE에서 단일 발행 — 여기서는 실패 토스트만.
 */
export function useUpdateTicket(): {
  /** 수정 트리거. */
  update: (
    id: string,
    patch: Partial<CreateTicketInput>,
    handlers?: { onSuccess?: () => void; onError?: (msg: string) => void },
  ) => void;
  /** 진행 중 여부. */
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const mutation = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<CreateTicketInput>;
    }) => updateTicket(id, patch),
    onSuccess: (ticket) => {
      queryClient.setQueryData<Ticket[]>(TICKETS_KEY, (prev) =>
        upsertTicket(prev ?? [], ticket),
      );
      notify({
        level: "success",
        category: "ticket",
        href: `/board?ticket=${ticket.id}`,
        title: "티켓 수정됨",
        detail: ticket.title,
      });
    },
    onError: (err) =>
      notify({
        level: "error",
        category: "ticket",
        href: "/board",
        title: "티켓 수정 실패",
        detail: toMessage(err),
      }),
  });

  return {
    update: (id, patch, handlers) =>
      mutation.mutate(
        { id, patch },
        {
          onSuccess: () => handlers?.onSuccess?.(),
          onError: (err) => handlers?.onError?.(toMessage(err)),
        },
      ),
    isPending: mutation.isPending,
  };
}

/**
 * 티켓 영구 삭제. 성공 시 캐시에서 제거 + 토스트, 실패는 토스트만.
 */
export function useDeleteTicket(): {
  /** 삭제 트리거. */
  remove: (
    id: string,
    handlers?: { onSuccess?: () => void; onError?: (msg: string) => void },
  ) => void;
  /** 진행 중 여부. */
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const mutation = useMutation({
    mutationFn: (id: string) => deleteTicket(id),
    onSuccess: (_void, id) => {
      queryClient.setQueryData<Ticket[]>(TICKETS_KEY, (prev) =>
        (prev ?? []).filter((t) => t.id !== id),
      );
      notify({
        level: "success",
        category: "ticket",
        href: "/board",
        title: "티켓 삭제됨",
        detail: id,
      });
    },
    onError: (err) =>
      notify({
        level: "error",
        category: "ticket",
        href: "/board",
        title: "티켓 삭제 실패",
        detail: toMessage(err),
      }),
  });
  return {
    remove: (id, handlers) =>
      mutation.mutate(id, {
        onSuccess: () => handlers?.onSuccess?.(),
        onError: (err) => handlers?.onError?.(toMessage(err)),
      }),
    isPending: mutation.isPending,
  };
}

/**
 * 티켓 상태 전이. 성공 토스트는 SSE 'ticket.updated'에서 단일 발행되므로 여기서 띄우지 않는다.
 * 실패만 즉시 토스트로 알린다 (서버에 도달도 못 한 경우).
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
 * 티켓 blocked 플래그 토글. 성공 토스트는 SSE에서 단일 발행 — 여기는 실패만.
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

/**
 * REVIEW 카드의 사용자 답변을 워커에게 전달.
 * 서버가 pendingQuestion 클리어 + 상태 전이를 일으키며, 결과 알림은 SSE에서 발행.
 */
export function useAnswerTicket(): {
  /** 답변 전송. */
  answer: (
    id: string,
    text: string,
    handlers?: { onSuccess?: () => void; onError?: (msg: string) => void },
  ) => void;
  /** 진행 중 여부. */
  isPending: boolean;
} {
  const notify = useNotify();
  const mutation = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      answerTicket(id, text),
    onSuccess: () => {
      notify({
        level: "success",
        category: "ticket",
        href: "/board",
        title: "답변 전송됨",
      });
    },
    onError: (err) =>
      notify({
        level: "error",
        category: "ticket",
        href: "/board",
        title: "답변 전송 실패",
        detail: toMessage(err),
      }),
  });

  return {
    answer: (id, text, handlers) =>
      mutation.mutate(
        { id, text },
        {
          onSuccess: () => handlers?.onSuccess?.(),
          onError: (err) => handlers?.onError?.(toMessage(err)),
        },
      ),
    isPending: mutation.isPending,
  };
}

type SsePayload = { type: "snapshot"; tickets: Ticket[] } | TicketEvent;

/**
 * 통합 SSE 버스의 "ticket" 토픽을 구독해 티켓 캐시를 갱신한다. unmount 시 unsubscribe.
 * 'ticket.updated'에서 status 변경이면 알림을 발행 (mutation/워커 어느 쪽이 일으키든 동일).
 */
function subscribeToTicketStream(
  queryClient: QueryClient,
  notify: ReturnType<typeof useNotify>,
): () => void {
  return subscribeSse<SsePayload>("ticket", (data) => {
    queryClient.setQueryData<Ticket[]>(TICKETS_KEY, (prev) =>
      applySseEvent(prev ?? [], data),
    );
    if (
      data.type === "ticket.updated" &&
      data.previous.status !== data.ticket.status
    ) {
      markTransition(data.ticket.id);
      notify({
        level: STATUS_LEVEL[data.ticket.status],
        category: "ticket",
        // 클릭 시 편집 모달이 아니라 카드에 잠깐 sky 링 포커스만 — 태스크 알림과 동일한 패턴.
        href: `/board?focus=${data.ticket.id}`,
        title: `${data.ticket.id} → ${STATUS_LABEL[data.ticket.status]}`,
        detail: data.ticket.title,
      });
    }
  });
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
