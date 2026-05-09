"use client";

import { useState } from "react";
import { Button } from "./Button";
import { inputBaseClass } from "./Field";
import { cn } from "./cn";

type StringListInputProps = {
  /** 현재 값. */
  value: string[];
  /** 변경 콜백. 새 배열을 그대로 전달한다. */
  onChange: (next: string[]) => void;
  /** 새 항목 입력 placeholder. */
  placeholder?: string;
};

export function StringListInput({
  value,
  onChange,
  placeholder,
}: StringListInputProps) {
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v) return;
    onChange([...value, v]);
    setDraft("");
  }

  function removeAt(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  function updateAt(i: number, v: string) {
    onChange(value.map((item, idx) => (idx === i ? v : item)));
  }

  return (
    <div className="flex flex-col gap-1.5">
      {value.length > 0 && (
        <ul className="flex flex-col gap-1">
          {value.map((item, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <input
                className={cn(inputBaseClass, "flex-1")}
                value={item}
                onChange={(e) => updateAt(i, e.target.value)}
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
      )}
      <div className="flex items-center gap-1.5">
        <input
          className={cn(inputBaseClass, "flex-1")}
          placeholder={placeholder ?? "항목 입력 후 Enter"}
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
