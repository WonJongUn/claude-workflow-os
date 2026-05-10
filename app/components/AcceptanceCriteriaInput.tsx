"use client";

import { useState } from "react";
import type { AcceptanceCriterion } from "@/lib/types";
import { Button, cn, inputBaseClass } from "./ui";

type AcceptanceCriteriaInputProps = {
  /** 현재 값. */
  value: AcceptanceCriterion[];
  /** 변경 콜백. 새 배열을 그대로 전달한다. */
  onChange: (next: AcceptanceCriterion[]) => void;
  /** 새 항목 입력 placeholder. */
  placeholder?: string;
};

/**
 * 완료 기준 편집기. 각 행에 체크박스 + 텍스트 input + 삭제 버튼.
 * 새 항목 추가는 항상 `checked: false`로. 모든 항목이 checked여야 DONE 전이 가능 — 서버가 강제.
 */
export function AcceptanceCriteriaInput({
  value,
  onChange,
  placeholder,
}: AcceptanceCriteriaInputProps) {
  const [draft, setDraft] = useState("");

  function add() {
    const text = draft.trim();
    if (!text) return;
    onChange([...value, { text, checked: false }]);
    setDraft("");
  }

  function removeAt(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  function updateText(i: number, text: string) {
    onChange(value.map((item, idx) => (idx === i ? { ...item, text } : item)));
  }

  function toggleChecked(i: number) {
    onChange(
      value.map((item, idx) =>
        idx === i ? { ...item, checked: !item.checked } : item,
      ),
    );
  }

  const completedCount = value.filter((v) => v.checked).length;

  return (
    <div className="flex flex-col gap-1.5">
      {value.length > 0 && (
        <>
          <ul className="flex flex-col gap-1">
            {value.map((item, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={() => toggleChecked(i)}
                  aria-label={`${item.text} 체크`}
                  className="h-4 w-4 shrink-0 cursor-pointer accent-zinc-900 dark:accent-zinc-100"
                />
                <input
                  className={cn(
                    inputBaseClass,
                    "flex-1",
                    item.checked && "text-zinc-500 line-through",
                  )}
                  value={item.text}
                  onChange={(e) => updateText(i, e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeAt(i)}
                >
                  ✕
                </Button>
              </li>
            ))}
          </ul>
          <div className="text-[10px] text-zinc-500">
            {completedCount} / {value.length} 완료
          </div>
        </>
      )}
      <div className="flex items-center gap-1.5">
        <input
          className={cn(inputBaseClass, "flex-1")}
          placeholder={placeholder ?? "기준 입력 후 Enter"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="ghost" size="sm" onClick={add}>
          + 추가
        </Button>
      </div>
    </div>
  );
}
