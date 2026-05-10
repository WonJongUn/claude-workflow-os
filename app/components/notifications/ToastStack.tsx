"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "../ui";
import { useNotifications } from "./NotificationProvider";
import type { Notification, NotificationLevel } from "./types";

const ICON: Record<NotificationLevel, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
};

const TONE: Record<NotificationLevel, string> = {
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  error:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
  info:
    "border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100",
  warning:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
};

/**
 * 우측 상단 고정 토스트 스택. 자동 4.5초 후 사라진다.
 */
export function ToastStack() {
  const { toasts, leavingIds, dismissToast } = useNotifications();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed right-4 top-16 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((note) => (
        <ToastItem
          key={note.id}
          note={note}
          leaving={leavingIds.has(note.id)}
          onClose={() => dismissToast(note.id)}
        />
      ))}
    </div>,
    document.body,
  );
}

function ToastItem({
  note,
  leaving,
  onClose,
}: {
  /** 표시할 알림. */
  note: Notification;
  /** true면 슬라이드 아웃 애니메이션 적용. */
  leaving: boolean;
  /** 수동 닫기. */
  onClose: () => void;
}) {
  const Icon = ICON[note.level];
  const router = useRouter();
  /** href가 있으면 본문 클릭으로 이동하고 토스트는 닫는다. */
  const handleClick = () => {
    if (!note.href) return;
    onClose();
    router.push(note.href);
  };
  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg",
        TONE[note.level],
        leaving ? "animate-toast-out" : "animate-toast-in",
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <button
        type="button"
        onClick={handleClick}
        disabled={!note.href}
        className={cn(
          "min-w-0 flex-1 text-left",
          note.href && "cursor-pointer",
        )}
        title={note.href ? "클릭해서 이동" : undefined}
      >
        <div className="truncate font-medium">{note.title}</div>
        {note.detail && (
          <div className="mt-0.5 whitespace-pre-line text-xs opacity-80">
            {note.detail}
          </div>
        )}
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="알림 닫기"
        className="rounded p-0.5 opacity-70 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
