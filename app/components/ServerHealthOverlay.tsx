"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 네트워크 단절 감지 오버레이.
 *
 * 폴링하지 않는다 — `navigator.onLine` + window `online`/`offline` 이벤트가
 * 단일 진실 원천. 폴링은 localhost HTTP/1.1 동시 연결 한도(6)에서
 * 다른 요청(SSE, worker-log, context 등)과 큐 경쟁해 false positive를 만들었다.
 *
 * 트레이드오프: 서버 프로세스만 죽고 OS 네트워크는 살아있는 케이스는 감지 못 함.
 * 그건 현재 도구가 로컬 전용이라 "터미널에서 dev 서버 죽음" → 즉시 사용자가 인지하므로
 * 추가 감지가 필요 없다. SSE가 끊어지면 use-tickets의 EventSource가 알아서 재연결.
 *
 * NotificationProvider처럼 layout 레벨에 마운트되어야 한다.
 */
export function ServerHealthOverlay() {
  const [offline, setOffline] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    function sync() {
      // navigator.onLine은 boolean — 브라우저별 정확도는 다르지만 false positive가 폴링 방식보다 훨씬 적다.
      setOffline(typeof navigator !== "undefined" && !navigator.onLine);
    }
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!mounted || !offline || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="alertdialog"
      aria-live="assertive"
      className="pointer-events-auto fixed inset-0 z-[80] flex items-center justify-center bg-zinc-900/60 backdrop-blur-sm"
    >
      <div className="mx-4 max-w-md rounded-xl border border-zinc-200 bg-white p-5 text-center shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          네트워크 연결이 끊겼습니다
        </div>
        <div className="text-xs text-zinc-600 dark:text-zinc-400">
          연결이 회복되면 자동으로 사라집니다.
        </div>
      </div>
    </div>,
    document.body,
  );
}
