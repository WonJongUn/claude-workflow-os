"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "./cn";

type ModalProps = {
  /** 모달이 화면에 표시되는지 여부. */
  open: boolean;
  /** 백드롭 클릭 또는 ESC 시 호출. */
  onClose: () => void;
  /** 헤더에 표시할 제목. */
  title: string;
  /** 모달 본문. */
  children: ReactNode;
  /** 본문 폭 제한. 기본 lg. */
  size?: "md" | "lg" | "xl";
  /** 헤더 우측(닫기 버튼 왼쪽)에 추가로 보여줄 액션. 모드 전환 토글 같은 보조 컨트롤용. */
  headerActions?: ReactNode;
};

const SIZE_CLASS: Record<NonNullable<ModalProps["size"]>, string> = {
  md: "max-w-lg",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
};

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "lg",
  headerActions,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-6 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "mt-12 w-full rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950",
          SIZE_CLASS[size],
        )}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {title}
          </h2>
          <div className="flex items-center gap-1">
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              title="닫기"
              className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
