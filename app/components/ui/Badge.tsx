import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Badge 색 의도. 도메인 enum을 직접 받지 않고 이 variant만 안다 (UI 프리미티브 분리).
 * 도메인 → variant 매핑은 *-meta.ts 모듈이 책임.
 */
export type BadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "subagent";

const variantClasses: Record<BadgeVariant, string> = {
  default:
    "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700",
  success:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900",
  warning:
    "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-amber-200 dark:border-amber-900",
  danger:
    "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300 border-red-200 dark:border-red-900",
  info: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300 border-sky-200 dark:border-sky-900",
  // 서브에이전트 표시 전용. 다른 뷰의 violet 좌측 가이드와 같은 톤으로 시각 통일.
  subagent:
    "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300 border-violet-200 dark:border-violet-900",
};

/** 의미 색을 가진 작은 칩. 한 줄 라벨 전용 — 긴 본문은 다른 표면 컴포넌트로. */
export function Badge({
  variant = "default",
  children,
  className,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
