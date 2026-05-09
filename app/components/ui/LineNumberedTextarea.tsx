"use client";

import { useMemo, useRef, type ChangeEvent } from "react";
import { cn } from "./cn";

type LineNumberedTextareaProps = {
  /** 현재 값. */
  value: string;
  /** 변경 콜백. */
  onChange: (next: string) => void;
  /** placeholder. */
  placeholder?: string;
  /** 추가 클래스 (높이 제어 등). */
  className?: string;
  /** id 속성 (Field와 연결 등). */
  id?: string;
};

/**
 * 좌측 거터에 줄 번호를 보여주는 마크다운/코드 입력 컴포넌트.
 * textarea의 스크롤에 거터를 동기화한다.
 */
export function LineNumberedTextarea({
  value,
  onChange,
  placeholder,
  className,
  id,
}: LineNumberedTextareaProps) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const lineCount = useMemo(() => Math.max(1, value.split("\n").length), [value]);

  function handleScroll(e: React.UIEvent<HTMLTextAreaElement>) {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value);
  }

  return (
    <div
      className={cn(
        "flex overflow-hidden rounded-md border border-zinc-300 bg-white font-mono text-xs leading-5 dark:border-zinc-700 dark:bg-zinc-900",
        "focus-within:border-zinc-500",
        className,
      )}
    >
      <div
        ref={gutterRef}
        aria-hidden
        className="select-none overflow-hidden border-r border-zinc-200 bg-zinc-50 px-2 py-2 text-right text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-600"
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        id={id}
        value={value}
        onChange={handleChange}
        onScroll={handleScroll}
        placeholder={placeholder}
        spellCheck={false}
        className="block flex-1 resize-none bg-transparent px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:outline-none dark:text-zinc-100"
      />
    </div>
  );
}
