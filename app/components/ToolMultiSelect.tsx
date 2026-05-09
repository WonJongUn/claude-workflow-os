"use client";

import { useState } from "react";
import { Button, cn, inputBaseClass } from "./ui";

/**
 * Claude Code 빌트인 도구. 자주 쓰는 것 위주로 큐레이션.
 */
const KNOWN_TOOLS: readonly string[] = [
  "Read",
  "Edit",
  "MultiEdit",
  "Write",
  "Bash",
  "BashOutput",
  "KillShell",
  "Grep",
  "Glob",
  "WebFetch",
  "WebSearch",
  "Task",
  "TodoWrite",
  "NotebookEdit",
];

type ToolMultiSelectProps = {
  /** 현재 선택된 도구 이름들. 알려진 도구 + 사용자 입력 도구가 섞일 수 있다. */
  value: string[];
  /** 변경 콜백. 새 배열 그대로 전달. */
  onChange: (next: string[]) => void;
};

/**
 * 알려진 도구는 토글 칩으로, 그 외는 직접 입력으로 추가/제거.
 */
export function ToolMultiSelect({ value, onChange }: ToolMultiSelectProps) {
  const [draft, setDraft] = useState("");
  const selected = new Set(value);
  const customs = value.filter((v) => !KNOWN_TOOLS.includes(v));

  function toggle(tool: string) {
    onChange(
      selected.has(tool) ? value.filter((v) => v !== tool) : [...value, tool],
    );
  }

  function addCustom() {
    const v = draft.trim();
    if (!v || selected.has(v)) {
      setDraft("");
      return;
    }
    onChange([...value, v]);
    setDraft("");
  }

  function removeCustom(tool: string) {
    onChange(value.filter((v) => v !== tool));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {KNOWN_TOOLS.map((tool) => {
          const on = selected.has(tool);
          return (
            <button
              key={tool}
              type="button"
              onClick={() => toggle(tool)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 font-mono text-xs transition-colors",
                on
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-500",
              )}
            >
              {tool}
            </button>
          );
        })}
      </div>

      {customs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {customs.map((tool) => (
            <span
              key={tool}
              className="inline-flex items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-2.5 py-0.5 font-mono text-xs text-sky-800 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-200"
            >
              {tool}
              <button
                type="button"
                onClick={() => removeCustom(tool)}
                aria-label={`${tool} 제거`}
                className="opacity-70 hover:opacity-100"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <input
          className={cn(inputBaseClass, "flex-1 font-mono text-xs")}
          placeholder="목록에 없는 도구를 입력 후 Enter (예: mcp__server__tool)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
        />
        <Button type="button" variant="ghost" size="sm" onClick={addCustom}>
          추가
        </Button>
      </div>
    </div>
  );
}
