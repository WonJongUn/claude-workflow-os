"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, cn, inputBaseClass } from "./ui";
import { searchFiles, type FileHit } from "./project-client";

const DROPDOWN_MAX_PX = 240;

type ReferencesInputProps = {
  /** 현재 참조 목록. */
  value: string[];
  /** 변경 콜백. 새 배열 그대로 전달. */
  onChange: (next: string[]) => void;
  /** 검색에 사용할 프로젝트 id. */
  projectId: string;
};

/**
 * 참조 파일 입력. `@` 입력으로 활성 프로젝트의 파일을 검색해 자동완성.
 * Enter는 입력값 그대로 또는 선택된 후보를 항목으로 추가.
 */
export function ReferencesInput({
  value,
  onChange,
  projectId,
}: ReferencesInputProps) {
  const [draft, setDraft] = useState("");
  const [hits, setHits] = useState<FileHit[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [direction, setDirection] = useState<"down" | "up">("down");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const mention = parseMention(draft);

  const mentionQuery = mention?.query ?? null;

  useEffect(() => {
    if (mentionQuery === null) return;
    let aborted = false;
    const id = setTimeout(async () => {
      try {
        const result = await searchFiles(projectId, mentionQuery);
        if (!aborted) {
          setHits(result);
          setHighlight(0);
        }
      } catch {
        // 검색 실패 시 이전 결과 유지: 드롭다운은 mention 게이트로 숨겨진다.
      }
    }, 120);
    return () => {
      aborted = true;
      clearTimeout(id);
    };
  }, [mentionQuery, projectId]);

  const showHits = mention !== null && hits.length > 0;

  useLayoutEffect(() => {
    if (!showHits || !inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    setDirection(
      spaceBelow < DROPDOWN_MAX_PX && spaceAbove > spaceBelow ? "up" : "down",
    );
  }, [showHits, hits.length]);

  function commit(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    onChange([...value, trimmed]);
    setDraft("");
    setHits([]);
  }

  function applyHit(hit: FileHit) {
    if (!mention) return;
    const next = `${draft.slice(0, mention.start)}${hit.relative}`;
    setDraft(next);
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
                className={cn(inputBaseClass, "flex-1 font-mono text-xs")}
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
      <div ref={wrapperRef} className="relative flex items-center gap-1.5">
        <input
          ref={inputRef}
          className={cn(inputBaseClass, "flex-1 font-mono text-xs")}
          placeholder="파일 경로 입력 또는 @로 검색"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (showHits) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => (h + 1) % hits.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => (h - 1 + hits.length) % hits.length);
                return;
              }
              if (e.key === "Tab" || e.key === "Enter") {
                e.preventDefault();
                applyHit(hits[highlight]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setDraft(draft.replace(/@\S*$/, ""));
                return;
              }
            }
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            }
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => commit(draft)}
        >
          + 추가
        </Button>
        {showHits && (
          <ul
            className={cn(
              "scroll-thin absolute left-0 right-0 z-50 max-h-60 overflow-y-auto overscroll-contain rounded-md border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950",
              direction === "down" ? "top-full mt-1" : "bottom-full mb-1",
            )}
            onMouseDown={(e) => e.preventDefault()}
          >
            {hits.map((hit, i) => (
              <li key={hit.absolute}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyHit(hit);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs",
                    i === highlight
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900",
                  )}
                >
                  <span>{hit.relative}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type Mention = {
  /** `@` 위치 (draft 내 인덱스). */
  start: number;
  /** `@` 다음의 검색 토큰. */
  query: string;
};

/**
 * draft 문자열의 끝 부분에서 `@<query>` 토큰을 추출. 없으면 null.
 */
function parseMention(draft: string): Mention | null {
  const lastAt = draft.lastIndexOf("@");
  if (lastAt === -1) return null;
  const after = draft.slice(lastAt + 1);
  if (/\s/.test(after)) return null;
  return { start: lastAt, query: after };
}
