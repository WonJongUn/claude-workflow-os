"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Notification, NotificationCategory, NotificationLevel } from "./types";
import { playNotificationSound } from "./sound";

const MAX_HISTORY = 50;
const TOAST_DISMISS_MS = 4500;
const TOAST_LEAVE_MS = 220;
const STORAGE_KEY = "notifications.history";

type Ctx = {
  /** 누적된 알림 (최신이 앞). */
  history: Notification[];
  /** 현재 화면에 떠 있는 토스트들. 슬라이드 아웃 중인 항목도 포함. */
  toasts: Notification[];
  /** 슬라이드 아웃 애니메이션 중인 토스트 id 집합. */
  leavingIds: ReadonlySet<string>;
  /** 알림 추가. id/createdAt은 자동 부여. */
  push: (input: {
    level: NotificationLevel;
    /** 도메인 분류. 패널 탭 필터링에 사용. */
    category: NotificationCategory;
    title: string;
    detail?: string;
    /** 알림 클릭 시 이동할 in-app 경로. */
    href?: string;
  }) => void;
  /** 토스트를 닫는다 (슬라이드 아웃 후 제거). 히스토리는 보존. */
  dismissToast: (id: string) => void;
  /** 히스토리 비우기. */
  clearHistory: () => void;
  /** 특정 카테고리의 히스토리만 비우기. */
  clearCategory: (category: NotificationCategory) => void;
};

const NotificationContext = createContext<Ctx | null>(null);
const NotifyContext = createContext<Ctx["push"] | null>(null);

/**
 * 앱 전역 알림 상태. 히스토리는 localStorage에 직렬화하여 페이지 전환에도 보존.
 */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<Notification[]>([]);
  const [toasts, setToasts] = useState<Notification[]>([]);
  const [leavingIds, setLeavingIds] = useState<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const leaveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Notification[];
      if (Array.isArray(parsed)) {
        // category 필드가 없는 구버전 항목은 "system"으로 fallback.
        const migrated = parsed.map((n) => ({
          ...n,
          category: n.category ?? "system",
        }));
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setHistory(migrated);
      }
    } catch {
      // 손상된 저장값 무시.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
      // 쿼터 초과 등은 무시.
    }
  }, [history]);

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    if (leaveTimersRef.current.has(id)) return;
    setLeavingIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    const t = setTimeout(() => {
      leaveTimersRef.current.delete(id);
      setToasts((prev) => prev.filter((n) => n.id !== id));
      setLeavingIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, TOAST_LEAVE_MS);
    leaveTimersRef.current.set(id, t);
  }, []);

  const push = useCallback<Ctx["push"]>(
    (input) => {
      const note: Notification = {
        id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        level: input.level,
        category: input.category,
        title: input.title,
        detail: input.detail,
        href: input.href,
        createdAt: Date.now(),
      };
      setHistory((prev) => [note, ...prev].slice(0, MAX_HISTORY));
      // 토스트는 최신이 위로 오도록 prepend.
      setToasts((prev) => [note, ...prev]);
      const timer = setTimeout(() => dismissToast(note.id), TOAST_DISMISS_MS);
      timersRef.current.set(note.id, timer);
      // 사운드는 사용자 설정/브라우저 정책에 따라 자동으로 swallow됨.
      playNotificationSound();
    },
    [dismissToast],
  );

  const clearHistory = useCallback(() => setHistory([]), []);

  const clearCategory = useCallback(
    (category: NotificationCategory) =>
      setHistory((prev) => prev.filter((n) => n.category !== category)),
    [],
  );

  useEffect(() => {
    const timers = timersRef.current;
    const leaveTimers = leaveTimersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      leaveTimers.forEach((t) => clearTimeout(t));
      leaveTimers.clear();
    };
  }, []);

  const value = useMemo<Ctx>(
    () => ({ history, toasts, leavingIds, push, dismissToast, clearHistory, clearCategory }),
    [history, toasts, leavingIds, push, dismissToast, clearHistory, clearCategory],
  );

  return (
    <NotificationContext.Provider value={value}>
      <NotifyContext.Provider value={push}>{children}</NotifyContext.Provider>
    </NotificationContext.Provider>
  );
}

/**
 * 알림 컨텍스트 접근. Provider 외부에서 호출하면 throw.
 */
export function useNotifications(): Ctx {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used inside NotificationProvider");
  return ctx;
}

/**
 * push만 노출하는 가벼운 훅. mutation 훅들이 사용한다.
 * 별도 컨텍스트라 토스트/히스토리 변경에 리렌더되지 않는다.
 */
export function useNotify(): Ctx["push"] {
  const push = useContext(NotifyContext);
  if (!push) throw new Error("useNotify must be used inside NotificationProvider");
  return push;
}
