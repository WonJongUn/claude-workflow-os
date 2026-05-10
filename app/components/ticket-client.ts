import axios from "axios";
import type {
  AcceptanceCriterion,
  Ticket,
  TicketPriority,
  TicketStatus,
} from "@/lib/types";

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
  /** 완료 판정 기준. 모두 checked일 때만 DONE 전이 가능. */
  acceptance_criteria?: AcceptanceCriterion[];
  /** 관련 파일/링크. */
  references?: string[];
  /** 자동 워커가 실행할 프로젝트 id. 미지정 시 워커가 픽업하지 않는다. */
  projectId?: string;
  /** 자동 스케줄링 활성. 미지정 시 서버 기본값 true. false면 OPEN이어도 워커 픽업 보류. */
  autoSchedule?: boolean;
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

/** 티켓 부분 갱신. TicketUpdateSchema 필드만 받는다. */
export async function updateTicket(
  id: string,
  patch: Partial<CreateTicketInput>,
): Promise<Ticket> {
  const { data } = await api.patch<Ticket>(`/tickets/${id}`, patch);
  return data;
}

/** 티켓 영구 삭제. 서버는 204 + SSE `ticket.deleted` 이벤트 emit. */
export async function deleteTicket(id: string): Promise<void> {
  await api.delete(`/tickets/${id}`);
}

/** 워커 로그 tail 응답. workerLog 파일 미존재 시 exists=false, content="". */
export type WorkerLogTail = {
  /** 마지막 N바이트 텍스트. 잘린 경우 첫 줄은 제거됨. */
  content: string;
  /** 파일이 디스크에 있는지 여부 — 워커가 한 번도 안 돌면 false. */
  exists: boolean;
  /** N바이트 한도로 잘렸는지 여부. */
  truncated: boolean;
  /** 전체 파일 크기 (bytes). */
  size?: number;
  /** 마지막 수정 시각 (epoch ms). */
  mtimeMs?: number;
};

/** 티켓의 워커 로그 마지막 32KB tail. UI 폴링용. */
export async function fetchWorkerLog(id: string): Promise<WorkerLogTail> {
  const { data } = await api.get<WorkerLogTail>(`/tickets/${id}/worker-log`);
  return data;
}

/**
 * REVIEW 상태에서 사용자가 입력한 답변을 워커에게 전달한다.
 * 서버가 pendingQuestion을 클리어하고 IN_PROGRESS로 되돌리거나, 별도 큐에 적재한다(백엔드 결정).
 */
export async function answerTicket(id: string, answer: string): Promise<void> {
  await api.post(`/tickets/${id}/answer`, { answer });
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
