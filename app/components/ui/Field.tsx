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

/**
 * 라벨 + 컨트롤 + 힌트를 묶는 폼 필드. <label>로 감싸 click→focus가 자연스럽다.
 * 모든 입력은 이 컴포넌트로 감싸야 한다 (직접 <label> 작성 금지 — design.md).
 */
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

/**
 * 모든 input/select/textarea가 공유하는 기본 클래스. 변형이 필요하면 prop을
 * 추가하지 말고 별도 primitive를 만든다 (design.md 폼 규칙).
 */
export const inputBaseClass =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
