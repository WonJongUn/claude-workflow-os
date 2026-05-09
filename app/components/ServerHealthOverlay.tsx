"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const PING_INTERVAL_MS = 10_000;
const PING_TIMEOUT_MS = 4_000;

/**
 * 서버 헬스 상태를 주기적으로 체크하고, 연결이 끊기면 모든 페이지를 dim 처리하면서 안내한다.
 *
 * - 첫 마운트 직후 1회 ping, 이후 PING_INTERVAL_MS 마다 polling.
 * - AbortController로 타임아웃 적용 — 서버가 hang하는 경우도 offline으로 간주.
 * - 회복되면 자동으로 오버레이 dismiss.
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
    let cancelled = false;
    async function ping() {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
      try {
        const res = await fetch("/api/health", {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (cancelled) return;
        setOffline(!res.ok);
      } catch {
        if (cancelled) return;
        setOffline(true);
      } finally {
        clearTimeout(timer);
      }
    }
    void ping();
    const id = setInterval(ping, PING_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
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
          서버에 연결할 수 없습니다
        </div>
        <div className="text-xs text-zinc-600 dark:text-zinc-400">
          서버가 실행 중인지 확인해 주세요. 연결이 회복되면 자동으로 사라집니다.
        </div>
      </div>
    </div>,
    document.body,
  );
}
