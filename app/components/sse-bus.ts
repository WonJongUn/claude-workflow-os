"use client";

/**
 * 단일 EventSource("/api/sse")를 띄우고 topic별로 fan-out하는 클라이언트 버스.
 *
 * *왜* — 브라우저 HTTP/1.1 6연결 한도 때문에 SSE 두 개를 따로 띄우면
 * 영구 점유 슬롯이 2개가 되어 폴링 burst가 큐에 밀린다. 단일 SSE + topic 라우팅이
 * 점유 슬롯을 1개로 줄여 다른 짧은 요청(health 등)을 살린다.
 *
 * 첫 subscribe 호출 때 lazy하게 EventSource를 만들고, 마지막 unsubscribe 후엔 닫는다 (refcount).
 */

type Listener = (data: unknown) => void;
type Envelope = { topic?: string };

const listeners = new Map<string, Set<Listener>>();
let es: EventSource | null = null;
let refcount = 0;

/** 모든 topic을 수신하는 단일 EventSource를 보장한다. 멱등. */
function ensure(): void {
  if (es) return;
  const source = new EventSource("/api/sse");
  source.addEventListener("message", (ev) => {
    let data: Envelope;
    try {
      data = JSON.parse((ev as MessageEvent).data) as Envelope;
    } catch {
      return;
    }
    const topic = data.topic;
    if (!topic) return;
    const set = listeners.get(topic);
    if (!set) return;
    for (const fn of set) fn(data);
  });
  // 자동 재연결은 EventSource 기본 동작에 맡긴다. onerror 로그는 dev 콘솔에만.
  source.addEventListener("error", () => {
    if (process.env.NODE_ENV !== "production") {
      // ReadyState: 0 connecting, 1 open, 2 closed
      console.warn("[sse-bus] error, readyState=", source.readyState);
    }
  });
  es = source;
}

/**
 * topic 채널을 구독한다. 반환값으로 unsubscribe.
 * 구독자가 0이 되면 EventSource를 close해 영구 소켓 점유를 풀어준다.
 */
export function subscribeSse<T = unknown>(
  topic: string,
  handler: (data: T) => void,
): () => void {
  ensure();
  refcount++;
  let set = listeners.get(topic);
  if (!set) {
    set = new Set();
    listeners.set(topic, set);
  }
  const wrapped: Listener = (data) => handler(data as T);
  set.add(wrapped);

  return () => {
    const s = listeners.get(topic);
    if (s) {
      s.delete(wrapped);
      if (s.size === 0) listeners.delete(topic);
    }
    refcount--;
    if (refcount <= 0 && es) {
      es.close();
      es = null;
      refcount = 0;
    }
  };
}
