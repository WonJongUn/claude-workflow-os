"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** 챗봇 한 메시지의 단일 컨텐츠 블록. 텍스트 또는 도구 호출 요약. */
export type ChatBlock =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; summary: string };

/** 한 메시지 (사용자 또는 어시스턴트). */
export type ChatMessage = {
  /** 클라이언트 임시 id. */
  id: string;
  role: "user" | "assistant";
  blocks: ChatBlock[];
  /** 어시스턴트 응답이 아직 스트리밍 중인지. */
  pending?: boolean;
};

/** 챗봇 리스트에 표시할 세션 메타. localStorage에 직렬화되어 보관된다. */
export type ChatSessionMeta = {
  /** Claude 세션 id. */
  id: string;
  /** cwd로 사용한 프로젝트 id. */
  projectId: string;
  /** 첫 사용자 메시지로 자동 채워진 한 줄 제목. */
  title: string;
  /** 마지막 메시지 미리보기 (사용자가 마지막으로 보낸/받은 텍스트). 없으면 title fallback. */
  lastMessage?: string;
  /** 마지막 활동 시각 (epoch ms). */
  updatedAt: number;
};

/** 위젯의 두 모드: 채팅 리스트 / 단일 대화 본문. */
export type ChatView =
  | { kind: "list" }
  | { kind: "chat"; sessionId: string | null; projectId: string };

/** 진행 중인 turn의 라이브 오버레이. ES 이벤트로 갱신된다. */
type ActiveStream = {
  /** `${projectId}:${sessionId|NEW}`. session_id가 도착하면 NEW → 실제 id. */
  key: string;
  userMsg: ChatMessage;
  assistantMsg: ChatMessage;
};

const SESSIONS_KEY = "chatbot:sessions";
const PROJECT_KEY = "chatbot:projectId";

/**
 * 챗봇 상태 관리.
 *
 * 통신 흐름:
 * - send: POST /api/chat → 첫 sessionId가 도착하면 즉시 응답. 본 처리는 백그라운드 spawn.
 * - 표시: 채팅 뷰에 진입하면 EventSource(/api/chat/sse?sessionId=…)를 항상 구독.
 *   서버는 `init` 이벤트로 현재 turn 스냅샷을 한 번 보내고, 이후 start/text/tool/end를 push.
 * - 모든 탭이 동일 경로를 사용 — 보낸 탭/다른 탭 구분 없음. 폴링 없이 실시간.
 * - 리스트 인디케이터는 /api/chat/active 폴링으로 진행 중 세션 id 집합 유지.
 */
export function useChatbot(): {
  view: ChatView;
  sessions: ChatSessionMeta[];
  messages: ChatMessage[];
  isStreaming: boolean;
  /** 서버에서 보고된 활성 세션 id 집합. 리스트 인디케이터용. */
  streamingSessionIds: Set<string>;
  isHistoryLoading: boolean;
  defaultProjectId: string | null;
  setDefaultProjectId: (id: string) => void;
  openSession: (sessionId: string, projectId: string) => Promise<void>;
  startNew: (projectId: string) => void;
  goBack: () => void;
  send: (message: string) => Promise<void>;
  abort: () => void;
  deleteSession: (sessionId: string) => void;
} {
  const [view, setView] = useState<ChatView>({ kind: "list" });
  const [sessions, setSessions] = useState<ChatSessionMeta[]>(() =>
    typeof window === "undefined" ? [] : loadSessions(),
  );
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [active, setActive] = useState<ActiveStream | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [serverActive, setServerActive] = useState<Set<string>>(() => new Set());
  const [defaultProjectId, setDefaultProjectIdState] = useState<string | null>(
    () =>
      typeof window === "undefined"
        ? null
        : window.localStorage.getItem(PROJECT_KEY),
  );

  const currentKey = viewKey(view);
  const isStreaming = active !== null && active.key === currentKey;

  /** history + 라이브 오버레이 합산. user dedup + trailing partial assistant 제거. */
  const messages = useMemo<ChatMessage[]>(() => {
    if (!active || active.key !== currentKey) return history;
    const liveUserText = userText(active.userMsg);
    let userIdx = -1;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === "user" && userText(history[i]) === liveUserText) {
        userIdx = i;
        break;
      }
    }
    if (userIdx >= 0) {
      return [...history.slice(0, userIdx + 1), active.assistantMsg];
    }
    return [...history, active.userMsg, active.assistantMsg];
  }, [active, currentKey, history]);

  const setDefaultProjectId = useCallback((id: string) => {
    window.localStorage.setItem(PROJECT_KEY, id);
    setDefaultProjectIdState(id);
  }, []);

  const upsertSession = useCallback(
    (
      meta: Omit<ChatSessionMeta, "title"> & { titleFallback: string },
    ) => {
      setSessions((prev) => {
        const existing = prev.find((s) => s.id === meta.id);
        const merged: ChatSessionMeta = existing
          ? {
              ...existing,
              updatedAt: meta.updatedAt,
              lastMessage: meta.lastMessage ?? existing.lastMessage,
            }
          : {
              id: meta.id,
              projectId: meta.projectId,
              title: meta.titleFallback,
              lastMessage: meta.lastMessage,
              updatedAt: meta.updatedAt,
            };
        const without = prev.filter((s) => s.id !== meta.id);
        const next = [merged, ...without];
        window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(next));
        return next;
      });
    },
    [],
  );

  const persistSessions = useCallback((next: ChatSessionMeta[]) => {
    window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(next));
    setSessions(next);
  }, []);

  const fetchHistory = useCallback(
    async (sessionId: string, opts?: { showLoading?: boolean }) => {
      if (opts?.showLoading !== false) setIsHistoryLoading(true);
      try {
        const res = await fetch(
          `/api/chat/history?sessionId=${encodeURIComponent(sessionId)}`,
        );
        if (!res.ok) {
          setHistory([]);
          return;
        }
        const data = (await res.json()) as {
          messages: Array<{
            role: "user" | "assistant";
            text: string;
            toolCalls: { name: string; filePath?: string }[];
          }>;
        };
        const restored: ChatMessage[] = data.messages.map((m, i) => {
          const blocks: ChatBlock[] = [];
          if (m.text.trim()) blocks.push({ kind: "text", text: m.text });
          for (const tc of m.toolCalls ?? []) {
            blocks.push({
              kind: "tool",
              name: tc.name,
              summary: tc.filePath ?? "",
            });
          }
          return { id: `h-${i}`, role: m.role, blocks };
        });
        setHistory(restored);
        // 마지막 어시스턴트 텍스트로 lastMessage 업데이트.
        const lastAssistant = [...restored]
          .reverse()
          .find((m) => m.role === "assistant");
        if (lastAssistant) {
          const text = userText(lastAssistant);
          if (text) {
            setSessions((prev) => {
              const idx = prev.findIndex((s) => s.id === sessionId);
              if (idx < 0) return prev;
              const next = [...prev];
              next[idx] = {
                ...next[idx],
                lastMessage: clip(text, 80),
              };
              window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(next));
              return next;
            });
          }
        }
      } finally {
        if (opts?.showLoading !== false) setIsHistoryLoading(false);
      }
    },
    [],
  );

  const openSession = useCallback(
    async (sessionId: string, projectId: string) => {
      setView({ kind: "chat", sessionId, projectId });
      setHistory([]);
      await fetchHistory(sessionId);
    },
    [fetchHistory],
  );

  const startNew = useCallback((projectId: string) => {
    setView({ kind: "chat", sessionId: null, projectId });
    setHistory([]);
  }, []);

  const goBack = useCallback(() => {
    setView({ kind: "list" });
    setHistory([]);
  }, []);

  const abort = useCallback(async () => {
    const sid = active?.key.split(":")[1];
    if (!sid || sid === "NEW") return;
    await fetch("/api/chat/abort", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: sid }),
    });
  }, [active]);

  const send = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      if (active) return;
      if (view.kind !== "chat") return;
      const projectId = view.projectId;
      if (!projectId || projectId === "ALL") return;
      const initialSessionId = view.sessionId;

      // 즉시 낙관적 표시 — POST 응답 기다리는 동안 사용자가 자기 메시지 + 빈 어시스턴트를 본다.
      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        blocks: [{ kind: "text", text: trimmed }],
      };
      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        blocks: [],
        pending: true,
      };
      const initialKey = initialSessionId
        ? `${projectId}:${initialSessionId}`
        : `${projectId}:NEW`;
      setActive({ key: initialKey, userMsg, assistantMsg });

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            sessionId: initialSessionId ?? undefined,
            projectId,
          }),
        });
        if (!res.ok) {
          const err = await res.text().catch(() => "");
          setActive((prev) =>
            prev
              ? appendActiveBlock(prev, {
                  kind: "text",
                  text: `⚠️ ${err || res.statusText}`,
                })
              : prev,
          );
          return;
        }
        const data = (await res.json()) as { sessionId: string };
        const sid = data.sessionId;
        // NEW였던 뷰에 sessionId 채우고, active 키 정정. ES effect가 sessionId를 보고 구독한다.
        if (initialSessionId === null) {
          setView((prev) =>
            prev.kind === "chat" && prev.sessionId === null
              ? { ...prev, sessionId: sid }
              : prev,
          );
        }
        setActive((prev) =>
          prev ? { ...prev, key: `${projectId}:${sid}` } : prev,
        );
        upsertSession({
          id: sid,
          projectId,
          lastMessage: clip(trimmed, 80),
          updatedAt: Date.now(),
          titleFallback: trimmed,
        });
      } catch (err) {
        setActive((prev) =>
          prev
            ? appendActiveBlock(prev, {
                kind: "text",
                text: `⚠️ ${err instanceof Error ? err.message : "네트워크 오류"}`,
              })
            : prev,
        );
      }
    },
    [active, upsertSession, view],
  );

  const deleteSession = useCallback(
    (sessionId: string) => {
      const next = sessions.filter((s) => s.id !== sessionId);
      persistSessions(next);
    },
    [persistSessions, sessions],
  );

  // 다른 탭이 sessions/projectId를 변경하면 storage 이벤트로 동기화.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: StorageEvent) => {
      if (e.key === SESSIONS_KEY) setSessions(loadSessions());
      else if (e.key === PROJECT_KEY)
        setDefaultProjectIdState(window.localStorage.getItem(PROJECT_KEY));
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  // 위젯 사용 중에는 서버 active 목록을 폴링 — 리스트 인디케이터.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/chat/active");
        if (!res.ok) return;
        const data = (await res.json()) as { sessionIds: string[] };
        if (cancelled) return;
        setServerActive(new Set(data.sessionIds));
      } catch {
        // ignore
      }
    };
    void tick();
    const t = window.setInterval(tick, 2_500);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  /**
   * 채팅 뷰 + sessionId가 정해진 동안 EventSource 구독.
   * init/start/text/tool/end 이벤트로 active overlay를 갱신.
   * end 시 history를 굳히고 서버에서 다시 fetch (jsonl 정합성).
   */
  const fetchHistoryRef = useRef(fetchHistory);
  fetchHistoryRef.current = fetchHistory;
  const upsertSessionRef = useRef(upsertSession);
  upsertSessionRef.current = upsertSession;

  useEffect(() => {
    if (view.kind !== "chat" || view.sessionId === null) return;
    const sid = view.sessionId;
    const projectId = view.projectId;
    const key = `${projectId}:${sid}`;
    const es = new EventSource(
      `/api/chat/sse?sessionId=${encodeURIComponent(sid)}`,
    );

    const ensureUserMsg = (snapText: string): ChatMessage => ({
      id: `u-${Date.now()}`,
      role: "user",
      blocks: [{ kind: "text", text: snapText }],
    });
    const emptyAssistant = (): ChatMessage => ({
      id: `a-${Date.now()}`,
      role: "assistant",
      blocks: [],
      pending: true,
    });

    es.addEventListener("init", (ev) => {
      try {
        const snap = JSON.parse(
          (ev as MessageEvent).data,
        ) as { userText: string; blocks: ChatBlock[] } | null;
        if (!snap) {
          setActive((prev) => (prev && prev.key === key ? null : prev));
          return;
        }
        setActive((prev) => {
          if (prev && prev.key === key) {
            return {
              ...prev,
              assistantMsg: {
                ...prev.assistantMsg,
                blocks: snap.blocks,
                pending: true,
              },
            };
          }
          return {
            key,
            userMsg: ensureUserMsg(snap.userText),
            assistantMsg: {
              ...emptyAssistant(),
              blocks: snap.blocks,
            },
          };
        });
      } catch {
        // ignore
      }
    });

    es.addEventListener("start", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          userText: string;
        };
        setActive((prev) => {
          if (prev && prev.key === key) return prev;
          return {
            key,
            userMsg: ensureUserMsg(data.userText),
            assistantMsg: emptyAssistant(),
          };
        });
      } catch {
        // ignore
      }
    });

    es.addEventListener("text", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { text: string };
        setActive((prev) =>
          prev && prev.key === key ? appendActiveText(prev, data.text) : prev,
        );
      } catch {
        // ignore
      }
    });

    es.addEventListener("tool", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          name: string;
          summary: string;
        };
        setActive((prev) =>
          prev && prev.key === key
            ? appendActiveTool(prev, data.name, data.summary)
            : prev,
        );
      } catch {
        // ignore
      }
    });

    es.addEventListener("end", () => {
      // active를 history에 굳히고 정리. 그 다음 jsonl 재페치로 정합성 확보.
      setActive((prev) => {
        if (!prev || prev.key !== key) return prev;
        setHistory((h) => {
          const finalAssistant: ChatMessage = {
            ...prev.assistantMsg,
            pending: false,
          };
          const liveUserText = userText(prev.userMsg);
          let userIdx = -1;
          for (let i = h.length - 1; i >= 0; i--) {
            if (h[i].role === "user" && userText(h[i]) === liveUserText) {
              userIdx = i;
              break;
            }
          }
          return userIdx >= 0
            ? [...h.slice(0, userIdx + 1), finalAssistant]
            : [...h, prev.userMsg, finalAssistant];
        });
        const assistantText = userText(prev.assistantMsg);
        if (assistantText) {
          upsertSessionRef.current({
            id: sid,
            projectId,
            lastMessage: clip(assistantText, 80),
            updatedAt: Date.now(),
            titleFallback: userText(prev.userMsg),
          });
        }
        return null;
      });
      void fetchHistoryRef.current(sid, { showLoading: false });
    });

    return () => {
      es.close();
    };
  }, [view]);

  return {
    view,
    sessions,
    messages,
    isStreaming,
    streamingSessionIds: serverActive,
    isHistoryLoading,
    defaultProjectId,
    setDefaultProjectId,
    openSession,
    startNew,
    goBack,
    send,
    abort,
    deleteSession,
  };
}

/** 뷰 식별자. */
function viewKey(v: ChatView): string {
  if (v.kind !== "chat") return "list";
  return `${v.projectId}:${v.sessionId ?? "NEW"}`;
}

/** 메시지의 첫 텍스트 블록. user dedup/lastMessage 표시용. */
function userText(m: ChatMessage): string {
  for (const b of m.blocks) if (b.kind === "text") return b.text;
  return "";
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function loadSessions(): ChatSessionMeta[] {
  try {
    const raw = window.localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is ChatSessionMeta =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as ChatSessionMeta).id === "string" &&
        typeof (s as ChatSessionMeta).projectId === "string" &&
        typeof (s as ChatSessionMeta).title === "string" &&
        typeof (s as ChatSessionMeta).updatedAt === "number",
    );
  } catch {
    return [];
  }
}

function appendActiveText(prev: ActiveStream, text: string): ActiveStream {
  const blocks = prev.assistantMsg.blocks;
  const last = blocks[blocks.length - 1];
  const nextBlocks: ChatBlock[] =
    last && last.kind === "text"
      ? [...blocks.slice(0, -1), { kind: "text", text: last.text + text }]
      : [...blocks, { kind: "text", text }];
  return {
    ...prev,
    assistantMsg: { ...prev.assistantMsg, blocks: nextBlocks },
  };
}

function appendActiveTool(
  prev: ActiveStream,
  name: string,
  summary: string,
): ActiveStream {
  return {
    ...prev,
    assistantMsg: {
      ...prev.assistantMsg,
      blocks: [...prev.assistantMsg.blocks, { kind: "tool", name, summary }],
    },
  };
}

function appendActiveBlock(
  prev: ActiveStream,
  block: ChatBlock,
): ActiveStream {
  return {
    ...prev,
    assistantMsg: {
      ...prev.assistantMsg,
      blocks: [...prev.assistantMsg.blocks, block],
    },
  };
}
