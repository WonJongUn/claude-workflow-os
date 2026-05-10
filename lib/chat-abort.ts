/**
 * 진행 중인 챗봇 spawn의 AbortController를 sessionId별로 보관.
 * 사용자가 "중단" 버튼을 눌렀을 때 /api/chat/abort가 여기서 찾아 abort.
 */
declare global {

  var __chatAborts: Map<string, AbortController> | undefined;
}

const aborts: Map<string, AbortController> =
  globalThis.__chatAborts ??
  (globalThis.__chatAborts = new Map<string, AbortController>());

/**
 * 새 챗봇 turn의 AbortController를 등록한다. /api/chat 라우트가 spawn 시작 직전에 호출.
 * 같은 sessionId가 이미 있으면 덮어쓴다 (직전 turn은 normal close 됐다고 가정).
 */
export function registerChatAbort(
  sessionId: string,
  ctrl: AbortController,
): void {
  aborts.set(sessionId, ctrl);
}

/**
 * turn이 정상 종료됐을 때 슬롯을 비운다. abort 후에도 멱등하게 호출 가능.
 */
export function unregisterChatAbort(sessionId: string): void {
  aborts.delete(sessionId);
}

/**
 * 진행 중인 turn을 중단한다. /api/chat/abort에서 호출.
 * @returns 실제로 abort된 컨트롤러가 있었으면 true, 슬롯이 비어 있었으면 false.
 */
export function abortChatSession(sessionId: string): boolean {
  const c = aborts.get(sessionId);
  if (!c) return false;
  c.abort();
  aborts.delete(sessionId);
  return true;
}
