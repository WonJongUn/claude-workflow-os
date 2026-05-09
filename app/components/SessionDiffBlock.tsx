"use client";

import { useMemo } from "react";
import { cn } from "./ui";

type DiffOp = { tag: " " | "-" | "+"; text: string };

/** 두 텍스트의 줄 단위 unified diff. LCS 기반. 외부 의존성 없음. */
export function lineDiff(a: string, b: string): DiffOp[] {
  const al = a.split("\n");
  const bl = b.split("\n");
  // LCS DP table.
  const m = al.length;
  const n = bl.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (al[i] === bl[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (al[i] === bl[j]) {
      ops.push({ tag: " ", text: al[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ tag: "-", text: al[i] });
      i++;
    } else {
      ops.push({ tag: "+", text: bl[j] });
      j++;
    }
  }
  while (i < m) ops.push({ tag: "-", text: al[i++] });
  while (j < n) ops.push({ tag: "+", text: bl[j++] });
  return ops;
}

type ChangeBlock =
  | { kind: "edit"; oldText: string; newText: string }
  | { kind: "write"; content: string };

type SessionDiffBlockProps = {
  /** 파일 경로 (헤더에 표시). */
  filePath: string;
  /** 한 도구 호출에 들어있는 변경 블록들. MultiEdit이면 여러 개. */
  changes: ChangeBlock[];
};

/**
 * Edit/MultiEdit/Write 도구 호출의 변경 내용을 unified diff 형태로 보여준다.
 * Edit·MultiEdit은 old/new 비교, Write는 추가만 표시 (이전 버전 비교 데이터 없음).
 */
export function SessionDiffBlock({ filePath, changes }: SessionDiffBlockProps) {
  const blocks = useMemo(
    () =>
      changes.map((c) =>
        c.kind === "edit"
          ? { kind: "edit" as const, ops: lineDiff(c.oldText, c.newText) }
          : { kind: "write" as const, ops: writeOps(c.content) },
      ),
    [changes],
  );

  return (
    <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
      <div className="border-b border-zinc-100 bg-zinc-50 px-2 py-1 font-mono text-[10px] text-zinc-600 dark:border-zinc-900 dark:bg-zinc-900 dark:text-zinc-400">
        {filePath}
      </div>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
        {blocks.map((b, i) => (
          <pre
            key={i}
            className="scroll-thin max-h-72 overflow-auto bg-white text-[11px] leading-snug dark:bg-zinc-950"
          >
            {b.ops.map((op, j) => (
              <DiffLine key={j} op={op} />
            ))}
          </pre>
        ))}
      </div>
    </div>
  );
}

function DiffLine({ op }: { op: DiffOp }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 whitespace-pre px-2 font-mono",
        op.tag === "+"
          ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
          : op.tag === "-"
            ? "bg-red-50 text-red-800 dark:bg-red-950/60 dark:text-red-200"
            : "text-zinc-700 dark:text-zinc-300",
      )}
    >
      <span
        className={cn(
          "shrink-0 select-none text-[10px]",
          op.tag === "+"
            ? "text-emerald-600"
            : op.tag === "-"
              ? "text-red-600"
              : "text-zinc-400",
        )}
      >
        {op.tag === " " ? " " : op.tag}
      </span>
      <span className="break-all">{op.text || "​"}</span>
    </div>
  );
}

function writeOps(content: string): DiffOp[] {
  return content.split("\n").map((text) => ({ tag: "+" as const, text }));
}
