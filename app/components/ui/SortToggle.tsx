"use client";

import { ArrowDownUp } from "lucide-react";
import { cn } from "./cn";

/** 정렬 방향. 'desc'=최신이 위. 'asc'=오래된 것이 위. */
export type SortOrder = "asc" | "desc";

type SortToggleProps = {
  /** 현재 정렬 방향. */
  order: SortOrder;
  /** 변경 핸들러. */
  onChange: (next: SortOrder) => void;
  /** 보조 라벨 (예: "정렬"). 기본 미표시. */
  label?: string;
};

/**
 * 리스트 상단에 두는 작은 토글. 두 옵션을 한 묶음에 보여주고 활성 옵션을 진하게.
 */
export function SortToggle({ order, onChange, label }: SortToggleProps) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-zinc-500">
      <ArrowDownUp className="h-3 w-3" aria-hidden />
      {label && <span>{label}</span>}
      <div className="inline-flex rounded-md border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-950">
        <SortOption
          active={order === "desc"}
          onClick={() => onChange("desc")}
          label="최신순"
        />
        <SortOption
          active={order === "asc"}
          onClick={() => onChange("asc")}
          label="시간순"
        />
      </div>
    </div>
  );
}

function SortOption({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-2 py-0.5 transition-colors",
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
      )}
    >
      {label}
    </button>
  );
}
