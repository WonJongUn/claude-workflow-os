"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * 최근 전이된 티켓 id의 강조 만료 시각(epoch ms). 만료 후엔 자동 삭제.
 * SSE 단일 시임 — `markTransition`만 쓰기 권한.
 */
const recent = new Map<string, number>();
const listeners = new Set<() => void>();

/** 강조 지속 시간 (ms). 카드 위치 이동·이목 끌기 모두 충분한 길이. */
const PULSE_MS = 1500;

function notify(): void {
  for (const l of listeners) l();
}

/**
 * 티켓이 방금 전이됐음을 기록한다. SSE `ticket.updated`(status 변경)에서 호출.
 * 같은 id에 대한 재호출은 만료 시각을 갱신.
 */
export function markTransition(ticketId: string): void {
  const expiresAt = Date.now() + PULSE_MS;
  recent.set(ticketId, expiresAt);
  notify();
  // 만료 직후 정리 — 다른 카드의 useSyncExternalStore도 다시 0을 받게 한다.
  setTimeout(() => {
    if ((recent.get(ticketId) ?? 0) <= Date.now()) {
      recent.delete(ticketId);
      notify();
    }
  }, PULSE_MS + 50);
}

/**
 * 카드가 자신의 강조 상태를 구독한다. true 반환이 끝나면 자동으로 false로 갱신.
 * 외부 상태이므로 useSyncExternalStore로 안전하게 구독.
 */
export function useTransitionPulse(ticketId: string): boolean {
  const subscribe = useCallback((cb: () => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);
  const getSnapshot = useCallback(
    () => ((recent.get(ticketId) ?? 0) > Date.now() ? 1 : 0),
    [ticketId],
  );
  // SSR에선 항상 0 — 강조는 클라 마운트 후에만 유의미하다.
  return useSyncExternalStore(subscribe, getSnapshot, () => 0) === 1;
}

/**
 * 알림 클릭 → 카드 임시 포커스 채널.
 * `markTransition`(상태 전이로 색이 바뀜)과 분리되어 있어 카드는 둘을 다른 색으로 그릴 수 있다.
 * 보드에서 URL `?focus=<id>` 진입 시 1회 호출 → 1.5초 sky-blue 링.
 */
const focused = new Map<string, number>();
const focusListeners = new Set<() => void>();
function notifyFocus(): void {
  for (const l of focusListeners) l();
}

/** 알림에서 들어온 카드를 잠깐 강조한다. 같은 id 재호출은 만료 시각을 갱신. */
export function markFocus(ticketId: string): void {
  const expiresAt = Date.now() + PULSE_MS;
  focused.set(ticketId, expiresAt);
  notifyFocus();
  setTimeout(() => {
    if ((focused.get(ticketId) ?? 0) <= Date.now()) {
      focused.delete(ticketId);
      notifyFocus();
    }
  }, PULSE_MS + 50);
}

/** 카드가 알림 포커스 상태인지 구독. PULSE_MS 동안 true. */
export function useFocusPulse(ticketId: string): boolean {
  const subscribe = useCallback((cb: () => void) => {
    focusListeners.add(cb);
    return () => {
      focusListeners.delete(cb);
    };
  }, []);
  const getSnapshot = useCallback(
    () => ((focused.get(ticketId) ?? 0) > Date.now() ? 1 : 0),
    [ticketId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => 0) === 1;
}
