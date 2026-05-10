"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bell, CheckCircle2, Info, Trash2, XCircle } from "lucide-react";
import { cn } from "../ui";
import { useNotifications } from "./NotificationProvider";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  type NotificationCategory,
  type NotificationLevel,
} from "./types";

/**
 * 탭 식별자. "all"은 모든 카테고리를 합쳐서 보여주는 가상 탭.
 */
type TabKey = "all" | NotificationCategory;

const LEVEL_ICON: Record<
  NotificationLevel,
  React.ComponentType<{ className?: string }>
> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
};

const LEVEL_TONE: Record<NotificationLevel, string> = {
  success: "text-emerald-600 dark:text-emerald-400",
  error: "text-red-600 dark:text-red-400",
  info: "text-sky-600 dark:text-sky-400",
  warning: "text-amber-600 dark:text-amber-400",
};

/**
 * 우측 상단에 고정된 알림 종. 누르면 누적 알림 패널이 펼쳐진다.
 */
export function NotificationBell() {
  const { history, clearHistory, clearCategory } = useNotifications();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // 카테고리별 개수. 탭 라벨 옆 작은 숫자에 사용.
  const counts = useMemo(() => {
    const acc: Partial<Record<NotificationCategory, number>> = {};
    for (const n of history) acc[n.category] = (acc[n.category] ?? 0) + 1;
    return acc;
  }, [history]);

  // 노출할 탭: 항상 "전체" 먼저, 그 뒤 카테고리들을 개수 내림차순. 동률은 CATEGORY_ORDER로 안정 정렬.
  const visibleTabs: TabKey[] = useMemo(() => {
    const sorted = [...CATEGORY_ORDER].sort((a, b) => {
      const diff = (counts[b] ?? 0) - (counts[a] ?? 0);
      if (diff !== 0) return diff;
      return CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b);
    });
    return ["all", ...sorted];
  }, [counts]);

  const filtered = useMemo(
    () =>
      activeTab === "all"
        ? history
        : history.filter((n) => n.category === activeTab),
    [activeTab, history],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={wrapperRef}
      className="pointer-events-auto fixed right-4 top-4 z-[70]"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="알림"
        title="알림"
        className={cn(
          "relative inline-flex h-9 w-9 items-center justify-center rounded-full border bg-white text-zinc-700 shadow-sm transition-colors hover:bg-zinc-100 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900",
          open
            ? "border-zinc-400 dark:border-zinc-600"
            : "border-zinc-200 dark:border-zinc-800",
        )}
      >
        <Bell className="h-4 w-4" aria-hidden />
        {history.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
            {history.length > 99 ? "99+" : history.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-full top-0 mr-2 w-96 max-w-[calc(100vw-5rem)] rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              알림
            </span>
            {history.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  activeTab === "all"
                    ? clearHistory()
                    : clearCategory(activeTab)
                }
                className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                {activeTab === "all"
                  ? "모두 비우기"
                  : `${CATEGORY_LABEL[activeTab]} 비우기`}
              </button>
            )}
          </div>
          <div className="scroll-hidden flex gap-1 overflow-x-auto border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            {visibleTabs.map((tab) => {
                const label = tab === "all" ? "전체" : CATEGORY_LABEL[tab];
                const count =
                  tab === "all" ? history.length : counts[tab] ?? 0;
                const isActive = tab === activeTab;
                const isEmpty = count === 0;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                      isActive
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : isEmpty
                          ? "text-zinc-400 hover:bg-zinc-100 dark:text-zinc-600 dark:hover:bg-zinc-900"
                        : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900",
                    )}
                  >
                    <span>{label}</span>
                    <span
                      className={cn(
                        "rounded px-1 text-[10px] font-semibold leading-tight",
                        isActive
                          ? "bg-white/20 text-white dark:bg-zinc-900/20 dark:text-zinc-900"
                          : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
          </div>
          <ul className="scroll-thin max-h-[60vh] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-900">
            {filtered.length === 0 ? (
              <li className="px-4 py-6 text-center text-xs text-zinc-500">
                {history.length === 0
                  ? "알림이 없습니다."
                  : "이 카테고리의 알림이 없습니다."}
              </li>
            ) : (
              filtered.map((note) => {
                const Icon = LEVEL_ICON[note.level];
                const body = (
                  <>
                    <Icon
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0",
                        LEVEL_TONE[note.level],
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-zinc-900 dark:text-zinc-100">
                        {note.title}
                      </div>
                      {note.detail && (
                        <div className="mt-0.5 whitespace-pre-line text-xs text-zinc-500">
                          {note.detail}
                        </div>
                      )}
                      <div className="mt-1 text-[10px] text-zinc-400">
                        {formatTime(note.createdAt)}
                      </div>
                    </div>
                  </>
                );
                if (note.href) {
                  // href 있는 새 알림은 클릭으로 라우팅. hover bg + cursor-pointer로 시인성 명확.
                  const href = note.href;
                  return (
                    <li key={note.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          router.push(href);
                        }}
                        className="flex w-full cursor-pointer items-start gap-2 px-4 py-2.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      >
                        {body}
                      </button>
                    </li>
                  );
                }
                // href 없는 (구) 알림은 단순 표시 — 클릭 동작 없음.
                return (
                  <li
                    key={note.id}
                    className="flex items-start gap-2 px-4 py-2.5"
                  >
                    {body}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>,
    document.body,
  );
}

function formatTime(ts: number): string {
  const date = new Date(ts);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${hh}:${mm}`;
}
