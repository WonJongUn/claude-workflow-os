import axios from "axios";
import type { Ticket, TicketPriority, TicketStatus } from "@/lib/types";

export type CreateTicketInput = {
  /** 사용자에게 표시되는 한 줄 요약. */
  title: string;
  /** 무엇을, 왜 해야 하는지. */
  goal: string;
  /** 보드 정렬과 알림 임계값에 사용. */
  priority: TicketPriority;
  /** 담당 에이전트 슬러그. 미지정 시 라우팅에서 결정. */
  agent?: string;
  /** 작업의 맥락/현재 상태. */
  background?: string;
  /** 충족해야 할 요구사항 항목들. */
  requirements?: string[];
  /** 완료 판정 기준. */
  acceptance_criteria?: string[];
  /** 관련 파일/링크. */
  references?: string[];
};

const api = axios.create({
  baseURL: "/api",
  headers: { "content-type": "application/json" },
});

type ListResponse = { tickets?: Ticket[] } | Ticket[];

export async function fetchTickets(): Promise<Ticket[]> {
  const { data } = await api.get<ListResponse>("/tickets");
  return Array.isArray(data) ? data : (data.tickets ?? []);
}

/**
 * 티켓을 다음 상태로 전이시킨다. 불법 전이는 서버가 409로 거부.
 */
export async function transitionTicket(
  id: string,
  next: TicketStatus,
): Promise<Ticket> {
  const { data } = await api.patch<Ticket>(`/tickets/${id}`, {
    transition: next,
  });
  return data;
}

export async function setBlocked(
  id: string,
  blocked: boolean,
  reason?: string,
): Promise<Ticket> {
  const { data } = await api.patch<Ticket>(`/tickets/${id}`, {
    blocked,
    reason,
  });
  return data;
}

export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  const { data } = await api.post<Ticket>("/tickets", {
    requirements: input.requirements ?? [],
    acceptance_criteria: input.acceptance_criteria ?? [],
    ...input,
  });
  return data;
}

export async function fetchPushPublicKey(): Promise<string | null> {
  try {
    const { data } = await api.get<{ publicKey?: string }>("/push");
    return data.publicKey ?? null;
  } catch {
    return null;
  }
}

export async function registerPushSubscription(
  sub: PushSubscriptionJSON,
): Promise<void> {
  await api.post("/push", sub);
}
