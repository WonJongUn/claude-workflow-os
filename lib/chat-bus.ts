import { EventEmitter } from "node:events";

/**
 * 진행 중인 챗봇 turn의 누적 콘텐츠.
 * 새로 SSE 구독하는 다른 탭이 처음에 받을 "스냅샷".
 */
export type ChatTurnSnapshot = {
  /** 사용자가 보낸 입력. user dedup용. */
  userText: string;
  /** 누적된 어시스턴트 블록(텍스트/도구). 클라이언트의 ChatBlock과 동일 스키마. */
  blocks: Array<
    | { kind: "text"; text: string }
    | { kind: "tool"; name: string; summary: string }
  >;
};

/** 다른 탭으로 푸시되는 챗봇 이벤트. type별 페이로드. */
export type ChatBusEvent =
  | { type: "start"; userText: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "end" };

/** 글로벌 채널로 emit되는 envelope. /api/sse가 모든 챗봇 이벤트를 fan-out할 때 사용. */
export type ChatBusEnvelope = ChatBusEvent & { sessionId: string };

/** 모든 챗봇 이벤트가 추가로 emit되는 글로벌 채널 이름. */
export const CHAT_GLOBAL = "*chat*" as const;

/**
 * Hot reload(dev) 시 동일 인스턴스 유지를 위해 globalThis 캐시.
 */
declare global {

  var __chatBus: EventEmitter | undefined;

  var __chatTurns: Map<string, ChatTurnSnapshot> | undefined;
}

const bus: EventEmitter =
  globalThis.__chatBus ?? (globalThis.__chatBus = new EventEmitter());
bus.setMaxListeners(0);

const turns: Map<string, ChatTurnSnapshot> =
  globalThis.__chatTurns ??
  (globalThis.__chatTurns = new Map<string, ChatTurnSnapshot>());

/** 세션이 현재 응답을 spawn 중인지. 리스트 인디케이터/history 라우트에서 활용. */
export function isChatActive(sessionId: string): boolean {
  return turns.has(sessionId);
}

/** 활성 세션 id 목록. /api/chat/active에서 그대로 노출. */
export function listActiveChat(): string[] {
  return Array.from(turns.keys());
}

/** 세션별 + 글로벌 두 곳에 emit. */
function emitBoth(sessionId: string, event: ChatBusEvent): void {
  bus.emit(sessionId, event);
  bus.emit(CHAT_GLOBAL, { ...event, sessionId } satisfies ChatBusEnvelope);
}

/** 새 turn 시작. 사용자 입력을 기록하고 구독자들에게 start emit. */
export function startChatTurn(sessionId: string, userText: string): void {
  turns.set(sessionId, { userText, blocks: [] });
  emitBoth(sessionId, { type: "start", userText });
}

/** 어시스턴트 텍스트 청크 누적. 마지막 블록이 text면 합치고 아니면 새 블록. */
export function appendChatText(sessionId: string, text: string): void {
  const t = turns.get(sessionId);
  if (!t) return;
  const last = t.blocks[t.blocks.length - 1];
  if (last && last.kind === "text") {
    last.text += text;
  } else {
    t.blocks.push({ kind: "text", text });
  }
  emitBoth(sessionId, { type: "text", text });
}

/** 도구 호출 한 줄 요약 추가. */
export function appendChatTool(
  sessionId: string,
  name: string,
  summary: string,
): void {
  const t = turns.get(sessionId);
  if (!t) return;
  t.blocks.push({ kind: "tool", name, summary });
  emitBoth(sessionId, { type: "tool", name, summary });
}

/** turn 종료. 스냅샷 제거 + end emit. */
export function endChatTurn(sessionId: string): void {
  if (!turns.has(sessionId)) return;
  turns.delete(sessionId);
  emitBoth(sessionId, { type: "end" });
}

/** 현재 진행 중 turn의 스냅샷. 신규 구독자에게 init으로 보낸다. */
export function getChatTurn(sessionId: string): ChatTurnSnapshot | null {
  return turns.get(sessionId) ?? null;
}

/** 세션별 이벤트 구독. 반환된 함수로 unsubscribe. */
export function subscribeChat(
  sessionId: string,
  listener: (event: ChatBusEvent) => void,
): () => void {
  bus.on(sessionId, listener);
  return () => {
    bus.off(sessionId, listener);
  };
}
