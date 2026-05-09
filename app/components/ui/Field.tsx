import type { ReactNode } from "react";
import { cn } from "./cn";

type FieldProps = {
  /** 필드 라벨. */
  label: string;
  /** 필수 표시 여부. */
  required?: boolean;
  /** 라벨 아래 보조 설명. */
  hint?: string;
  /** 컨트롤. */
  children: ReactNode;
  /** 가로 폭 클래스 추가. */
  className?: string;
};

export function Field({
  label,
  required,
  hint,
  children,
  className,
}: FieldProps) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
      {hint && (
        <span className="text-[11px] text-zinc-500 dark:text-zinc-500">
          {hint}
        </span>
      )}
    </label>
  );
}

export const inputBaseClass =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
