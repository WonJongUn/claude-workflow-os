import axios from "axios";
import type { Ticket, TicketPriority, TicketStatus } from "@/lib/types";

/** NewTicketForm이 만들어 createTicket으로 보내는 페이로드. 서버 TicketDraft의 클라 측 표현. */
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

/** 모든 티켓 조회. 서버는 배열 또는 `{tickets:[...]}` 둘 다 응답할 수 있어 양쪽 호환. */
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

/**
 * blocked 플래그/사유 설정. blocked=true 진입 시 서버가 Web Push 발송.
 * blocked=false면 reason은 서버에서 무시되어 클리어된다.
 */
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

/** 새 티켓 생성. 서버가 id/타임스탬프/초기 상태를 채워 반환. */
export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  const { data } = await api.post<Ticket>("/tickets", {
    requirements: input.requirements ?? [],
    acceptance_criteria: input.acceptance_criteria ?? [],
    ...input,
  });
  return data;
}

/**
 * Push 구독에 사용할 VAPID 공개 키. 서버 env 미설정 시 null —
 * UI는 푸시 가입 버튼을 비활성화한다. 네트워크 실패도 null로 fallback.
 */
export async function fetchPushPublicKey(): Promise<string | null> {
  try {
    const { data } = await api.get<{ publicKey?: string }>("/push");
    return data.publicKey ?? null;
  } catch {
    return null;
  }
}

/** 브라우저가 만든 PushSubscription을 서버에 등록. endpoint 기준 idempotent. */
export async function registerPushSubscription(
  sub: PushSubscriptionJSON,
): Promise<void> {
  await api.post("/push", sub);
}
