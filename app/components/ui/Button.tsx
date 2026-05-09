import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

/**
 * Button 시각 의도. design.md "버튼 변형":
 * primary=주요 CTA, ghost=보조(테두리만), danger=파괴적 confirm.
 */
export type ButtonVariant = "primary" | "ghost" | "danger";

/** Button 높이/패딩 토큰. sm은 표 내부 인라인 액션, md는 폼/모달 기본. */
export type ButtonSize = "sm" | "md";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200",
  ghost:
    "bg-transparent text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900 border border-zinc-200 dark:border-zinc-800",
  danger:
    "bg-red-600 text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-7 px-2 text-xs",
  md: "h-9 px-3 text-sm",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

/**
 * 표준 버튼. 자식은 `<Icon /> <span>라벨</span>` 두 자식이 기본 (gap-1.5 자동).
 * 인라인 미니 토글에는 사용하지 않는다 (직접 button + class).
 */
export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
