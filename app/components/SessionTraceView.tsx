"use client";

import { memo, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { LazyMarkdown } from "./LazyMarkdown";
import { SessionCodeBlock } from "./SessionCodeBlock";
import { SessionDiffBlock } from "./SessionDiffBlock";
import { cn, SortToggle, type SortOrder } from "./ui";
import {
  extractEditChanges,
  extractToolUseId,
  normalizeContent,
  type ParsedEvent,
} from "./session-log-shared";

type TraceSpan =
  | { kind: "assistantText"; event: ParsedEvent }
  | {
      kind: "toolCall";
      toolUse: ParsedEvent;
      toolResult?: ParsedEvent;
      sidechain: boolean;
    };

type TraceTurn = {
  user?: ParsedEvent;
  spans: TraceSpan[];
};

/**
 * 트레이스 뷰: 사용자 턴을 루트로 묶고, 그 안에 어시스턴트 텍스트 + 도구 호출(↔결과 매칭)을
 * 들여써서 보여준다. 사이드체인은 별도 인덴트 영역으로 시각 분리.
 */
export default function SessionTraceView({ events }: { events: ParsedEvent[] }) {
  const turns = useMemo(() => buildTrace(events), [events]);
  const [order, setOrder] = useState<SortOrder>("desc");
  const numbered = useMemo(
    () => turns.map((t, i) => ({ turn: t, index: i + 1 })),
    [turns],
  );
  const ordered = useMemo(
    () => (order === "desc" ? [...numbered].reverse() : numbered),
    [numbered, order],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: ordered.length,
    getScrollElement: () => scrollRef.current,
    // 트레이스의 한 턴은 보통 사용자 프롬프트 + 어시스턴트 텍스트 + 도구 호출 여러 개로 매우 길다.
    // 초기 추정값을 크게 잡아 첫 마운트에 그려지는 턴 수를 최소화한다.
    estimateSize: () => 600,
    overscan: 1,
    measureElement: (el) => el.getBoundingClientRect().height,
  });
  if (turns.length === 0) {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        트레이스로 묶을 이벤트가 없습니다.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <SortToggle order={order} onChange={setOrder} />
      </div>
      <div ref={scrollRef} className="scroll-thin max-h-[75vh] overflow-y-auto">
        <ol
          className="relative divide-y divide-zinc-100 dark:divide-zinc-900"
          style={{ height: virt.getTotalSize() }}
        >
          {virt.getVirtualItems().map((row) => {
            const { turn, index } = ordered[row.index];
            return (
              <li
                key={row.key}
                ref={virt.measureElement}
                data-index={row.index}
                className="absolute inset-x-0"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <TraceTurnView turn={turn} index={index} />
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function buildTrace(events: ParsedEvent[]): TraceTurn[] {
  const resultsById = new Map<string, ParsedEvent>();
  for (const ev of events) {
    if (ev.kind !== "tool_result") continue;
    const id = extractToolUseId(ev.raw, "tool_result");
    if (id) resultsById.set(id, ev);
  }
  const turns: TraceTurn[] = [];
  let current: TraceTurn | null = null;
  for (const ev of events) {
    if (ev.kind === "user") {
      current = { user: ev, spans: [] };
      turns.push(current);
      continue;
    }
    if (!current) {
      current = { spans: [] };
      turns.push(current);
    }
    if (ev.kind === "assistant") {
      current.spans.push({ kind: "assistantText", event: ev });
    } else if (ev.kind === "tool_use") {
      const id = extractToolUseId(ev.raw, "tool_use");
      const toolResult = id ? resultsById.get(id) : undefined;
      current.spans.push({
        kind: "toolCall",
        toolUse: ev,
        toolResult,
        sidechain: ev.sidechain === true,
      });
    }
  }
  return turns;
}

const TraceTurnView = memo(function TraceTurnView({
  turn,
  index,
}: {
  turn: TraceTurn;
  index: number;
}) {
  return (
    <div className="flex gap-3 py-4">
      <span className="w-32 shrink-0 pt-0.5 font-mono text-[10px] tabular-nums text-zinc-500">
        {turn.user?.timestamp
          ? new Date(turn.user.timestamp).toLocaleString()
          : ""}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2 text-[10px] text-zinc-500">
          <span className="rounded-full bg-zinc-200 px-2 py-0.5 font-mono text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            턴 {index}
          </span>
        </div>
        {turn.user && (
          <div className="text-xs text-zinc-800 dark:text-zinc-200">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              사용자
            </div>
            {turn.user.text ? (
              <LazyMarkdown text={turn.user.text} />
            ) : (
              <span className="text-zinc-400">—</span>
            )}
          </div>
        )}
        <TraceTurnSpans spans={turn.spans} />
      </div>
    </div>
  );
});

const SPAN_INITIAL = 6;

/**
 * 한 턴의 spans를 점진 렌더한다.
 * 도구 호출이 수십 개인 턴에서는 모두를 한 번에 그리면 무거워, 기본은 SPAN_INITIAL개만
 * 보여주고 사용자가 명시적으로 펼치면 나머지를 마운트한다.
 */
const TraceTurnSpans = memo(function TraceTurnSpans({
  spans,
}: {
  spans: TraceSpan[];
}) {
  const [showAll, setShowAll] = useState(false);
  const visible =
    showAll || spans.length <= SPAN_INITIAL ? spans : spans.slice(0, SPAN_INITIAL);
  const hidden = spans.length - visible.length;
  return (
    <ol className="flex flex-col gap-2 pl-3">
      {visible.map((s, i) => (
        <TraceSpanView key={i} span={s} />
      ))}
      {hidden > 0 && (
        <li>
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="rounded border border-zinc-200 px-2 py-0.5 text-[10px] text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            ▸ 나머지 {hidden}개 펼치기
          </button>
        </li>
      )}
    </ol>
  );
});

const TraceSpanView = memo(function TraceSpanView({
  span,
}: {
  span: TraceSpan;
}) {
  if (span.kind === "assistantText") {
    return (
      <li className="border-l-2 border-emerald-300 pl-2 text-xs text-zinc-800 dark:border-emerald-800 dark:text-zinc-200">
        <div className="text-[10px] font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
          어시스턴트
        </div>
        {span.event.text ? (
          <LazyMarkdown text={span.event.text} />
        ) : (
          <span className="text-zinc-400">—</span>
        )}
      </li>
    );
  }
  return (
    <TraceToolCall
      toolUse={span.toolUse}
      toolResult={span.toolResult}
      sidechain={span.sidechain}
    />
  );
});

const TraceToolCall = memo(function TraceToolCall({
  toolUse,
  toolResult,
  sidechain,
}: {
  toolUse: ParsedEvent;
  toolResult?: ParsedEvent;
  sidechain: boolean;
}) {
  const changes = useMemo(() => extractEditChanges(toolUse), [toolUse]);
  const [expanded, setExpanded] = useState(false);
  const hasDiff = changes.changes.length > 0;
  const isError =
    toolResult?.raw.message?.content &&
    (() => {
      const blocks = normalizeContent(toolResult.raw.message?.content);
      const tr = blocks.find((b) => b.type === "tool_result");
      return tr?.type === "tool_result" && tr.is_error === true;
    })();
  return (
    <li
      className={cn(
        "border-l-2 pl-2 text-xs",
        sidechain
          ? "border-violet-300 dark:border-violet-700"
          : isError
            ? "border-red-300 dark:border-red-800"
            : "border-sky-300 dark:border-sky-800",
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px]">
        <span
          className={cn(
            "font-medium uppercase tracking-wider",
            sidechain
              ? "text-violet-600 dark:text-violet-400"
              : "text-sky-600 dark:text-sky-400",
          )}
        >
          {sidechain ? "사이드체인" : "도구"}
        </span>
        <span className="font-mono text-zinc-700 dark:text-zinc-300">
          {toolUse.toolName}
        </span>
        {isError && (
          <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
            error
          </span>
        )}
      </div>
      {toolUse.text ? (
        <div className="mt-0.5">
          <SessionCodeBlock text={toolUse.text} language="json" />
        </div>
      ) : (
        <div className="mt-0.5 truncate text-zinc-700 dark:text-zinc-300">
          {toolUse.preview}
        </div>
      )}
      {toolResult && (
        <div className="mt-1">
          <div className="mb-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
            ↳ 결과
          </div>
          {toolResult.text ? (
            <SessionCodeBlock text={toolResult.text} language="text" />
          ) : (
            <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
              {toolResult.preview}
            </div>
          )}
        </div>
      )}
      {hasDiff && (
        <div className="mt-1 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="self-start rounded border border-zinc-200 px-2 py-0.5 text-[10px] text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            {expanded
              ? "▾ 변경 내역 닫기"
              : `▸ 변경 내역 보기 (${changes.changes.length})`}
          </button>
          {expanded && (
            <SessionDiffBlock
              filePath={changes.filePath}
              changes={changes.changes}
            />
          )}
        </div>
      )}
    </li>
  );
});
