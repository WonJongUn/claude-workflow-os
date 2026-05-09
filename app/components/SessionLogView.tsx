"use client";

import { lazy, memo, Suspense, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SessionDiffBlock } from "./SessionDiffBlock";
import { SortToggle, Tooltip, type SortOrder } from "./ui";
import { LazyMarkdown } from "./LazyMarkdown";
import { SessionCodeBlock } from "./SessionCodeBlock";
import {
  KIND_LABEL,
  KIND_TOOLTIP,
  SIDECHAIN_TOOLTIP,
  extractEditChanges,
  formatDuration,
  normalizeContent,
  type ContentBlock,
  type ParsedEvent,
  type RawEvent,
  type SessionStats,
} from "./session-log-shared";

/**
 * 무거운 보조 뷰는 동적 import로 분리해 초기 chunk를 가볍게 한다.
 * 사용자가 해당 탭을 처음 클릭한 시점에 비로소 JS가 받아져 파싱된다.
 */
const SessionTraceView = lazy(() => import("./SessionTraceView"));
const SessionTraceV2View = lazy(() => import("./SessionTraceV2View"));
const SessionSwimLaneView = lazy(() => import("./SessionSwimLaneView"));
const SessionChartsView = lazy(() => import("./SessionChartsView"));

/**
 * Claude Code 세션 jsonl을 파싱해 통계 + 타임라인을 보여준다.
 * 알 수 없는 필드는 무시하고, 알려진 필드만 안전하게 추출한다.
 */
export function SessionLogView({
  body,
  view: controlledView,
  hideChrome,
  sessionId,
}: {
  /** jsonl 본문 (마지막 N바이트). */
  body: string;
  /** 외부에서 뷰를 강제. 미지정 시 내부 상태 사용. */
  view?: "timeline" | "trace" | "trace_v2" | "swim" | "charts" | "raw";
  /** 통계·뷰 토글을 숨김. 페이지가 자체 탭/통계를 띄울 때 사용. */
  hideChrome?: boolean;
  /** trace_v2 뷰가 trace id로 노출. 미지정 시 빈 문자열. */
  sessionId?: string;
}) {
  const events = useMemo(() => parseLog(body), [body]);
  const stats = useMemo(() => computeStats(events), [events]);
  const [internalView, setInternalView] = useState<
    "timeline" | "trace" | "trace_v2" | "swim" | "charts" | "raw"
  >("timeline");
  const view = controlledView ?? internalView;

  if (events.length === 0) {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        파싱 가능한 이벤트가 없습니다.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!hideChrome && (
        <>
          <StatsRow stats={stats} />
          <ViewToggle view={view} onChange={setInternalView} />
        </>
      )}
      {view === "raw" && (
        <pre className="scroll-thin max-h-[50vh] overflow-auto whitespace-pre-wrap break-all rounded-md border border-zinc-200 bg-zinc-50 p-4 font-mono text-[11px] leading-relaxed text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
          {body}
        </pre>
      )}
      {view === "timeline" && <Timeline events={events} />}
      {view === "trace" && (
        <Suspense fallback={<LazyViewFallback />}>
          <SessionTraceView events={events} />
        </Suspense>
      )}
      {view === "trace_v2" && (
        <Suspense fallback={<LazyViewFallback />}>
          <SessionTraceV2View events={events} sessionId={sessionId ?? ""} />
        </Suspense>
      )}
      {view === "swim" && (
        <Suspense fallback={<LazyViewFallback />}>
          <SessionSwimLaneView events={events} stats={stats} />
        </Suspense>
      )}
      {view === "charts" && (
        <Suspense fallback={<LazyViewFallback />}>
          <SessionChartsView events={events} stats={stats} />
        </Suspense>
      )}
    </div>
  );
}

/** lazy 청크가 받아지기 전 보여줄 placeholder. */
function LazyViewFallback() {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
      뷰 로딩 중…
    </div>
  );
}

type ViewMode = "timeline" | "trace" | "trace_v2" | "swim" | "charts" | "raw";

function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  const opts: { id: ViewMode; label: string }[] = [
    { id: "timeline", label: "타임라인" },
    { id: "trace", label: "트레이스" },
    { id: "trace_v2", label: "트레이스 V2" },
    { id: "swim", label: "스윔레인" },
    { id: "charts", label: "통계" },
    { id: "raw", label: "원본" },
  ];
  return (
    <div className="inline-flex self-end rounded-md border border-zinc-200 bg-white p-0.5 text-xs dark:border-zinc-800 dark:bg-zinc-950">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={
            view === o.id
              ? "rounded bg-zinc-900 px-3 py-1 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "rounded px-3 py-1 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SessionStatsRow({ stats }: { stats: SessionStats }) {
  return <StatsRow stats={stats} />;
}

function StatsRow({ stats }: { stats: SessionStats }) {
  const duration =
    stats.firstTs && stats.lastTs ? stats.lastTs - stats.firstTs : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        <Stat label="이벤트" value={String(stats.total)} />
        <Stat
          label="사용자 / 어시스턴트"
          value={`${stats.user} / ${stats.assistant}`}
        />
        <Stat
          label="도구 호출"
          value={`${stats.toolUse}${stats.toolResult ? ` (응답 ${stats.toolResult})` : ""}`}
        />
        <Stat label="기간" value={duration > 0 ? formatDuration(duration) : "—"} />
      </dl>
      {stats.lastModel && (
        <div className="flex items-baseline gap-2 text-xs">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            모델
          </span>
          <span className="truncate font-mono text-zinc-900 dark:text-zinc-100">
            {stats.lastModel}
          </span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </dt>
      <dd className="font-mono text-zinc-900 dark:text-zinc-100">{value}</dd>
    </div>
  );
}

function Timeline({ events }: { events: ParsedEvent[] }) {
  const [order, setOrder] = useState<SortOrder>("desc");
  const ordered = useMemo(
    () => (order === "desc" ? [...events].reverse() : events),
    [events, order],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: ordered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 80,
    overscan: 6,
    measureElement: (el) => el.getBoundingClientRect().height,
  });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <SortToggle order={order} onChange={setOrder} />
      </div>
      <div ref={scrollRef} className="scroll-thin max-h-[70vh] overflow-y-auto">
        <ul
          className="relative divide-y divide-zinc-100 dark:divide-zinc-900"
          style={{ height: virt.getTotalSize() }}
        >
          {virt.getVirtualItems().map((row) => {
            const ev = ordered[row.index];
            return (
              <li
                key={row.key}
                ref={virt.measureElement}
                data-index={row.index}
                className="absolute inset-x-0"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <TimelineRow event={ev} />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

const TimelineRow = memo(function TimelineRow({ event: ev }: { event: ParsedEvent }) {
  const changes = useMemo(() => extractEditChanges(ev), [ev]);
  const [expanded, setExpanded] = useState(false);
  const hasDiff = changes.changes.length > 0;
  return (
    <div className="flex gap-3 py-2.5">
      <span className="w-32 shrink-0 pt-0.5 font-mono text-[10px] tabular-nums text-zinc-500">
        {ev.timestamp ? new Date(ev.timestamp).toLocaleString() : ""}
      </span>
      <KindBadge kind={ev.kind} sidechain={ev.sidechain} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[10px] text-zinc-500">
          {ev.toolName && (
            <span className="font-mono text-sky-600 dark:text-sky-400">
              {ev.toolName}
            </span>
          )}
          {ev.model && <span className="font-mono">{ev.model}</span>}
        </div>
        <div className="mt-0.5 text-xs text-zinc-800 dark:text-zinc-200">
          {(ev.kind === "user" || ev.kind === "assistant") && ev.text ? (
            <LazyMarkdown text={ev.text} />
          ) : ev.kind === "tool_use" && ev.text ? (
            <SessionCodeBlock text={ev.text} language="json" />
          ) : ev.kind === "tool_result" && ev.text ? (
            <SessionCodeBlock text={ev.text} language="text" />
          ) : ev.text ? (
            <LazyMarkdown text={ev.text} />
          ) : ev.preview ? (
            <LazyMarkdown text={ev.preview} />
          ) : (
            <span className="text-zinc-400">—</span>
          )}
        </div>
        {hasDiff && (
          <div className="mt-1 flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="self-start rounded border border-zinc-200 px-2 py-0.5 text-[10px] text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
            >
              {expanded ? "▾ 변경 내역 닫기" : `▸ 변경 내역 보기 (${changes.changes.length})`}
            </button>
            {expanded && (
              <SessionDiffBlock
                filePath={changes.filePath}
                changes={changes.changes}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
});

const KIND_TONE: Record<ParsedEvent["kind"], string> = {
  user: "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  assistant:
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  tool_use:
    "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300",
  tool_result:
    "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  summary:
    "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300",
  system:
    "border-zinc-300 bg-white text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400",
  other:
    "border-zinc-300 bg-white text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400",
};

function KindBadge({
  kind,
  sidechain,
}: {
  kind: ParsedEvent["kind"];
  sidechain?: boolean;
}) {
  return (
    <div className="flex w-20 shrink-0 flex-col items-start gap-0.5">
      <Tooltip content={KIND_TOOLTIP[kind]}>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${KIND_TONE[kind]}`}
        >
          {KIND_LABEL[kind]}
        </span>
      </Tooltip>
      {sidechain && (
        <Tooltip content={SIDECHAIN_TOOLTIP}>
          <span className="text-[9px] text-zinc-500">서브에이전트</span>
        </Tooltip>
      )}
    </div>
  );
}

export function parseSessionLog(body: string): ParsedEvent[] {
  return parseLog(body);
}

export function computeSessionStats(events: ParsedEvent[]): SessionStats {
  return computeStats(events);
}

export type SessionParsedEvent = ParsedEvent;
export type SessionLogStats = SessionStats;

function parseLog(body: string): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let raw: RawEvent;
    try {
      raw = JSON.parse(trimmed) as RawEvent;
    } catch {
      continue;
    }
    out.push(toParsed(raw));
  }
  return out;
}

function toParsed(raw: RawEvent): ParsedEvent {
  const ts = raw.timestamp ? Date.parse(raw.timestamp) : undefined;
  const baseKind = classifyKind(raw);
  if (raw.type === "summary") {
    return {
      raw,
      timestamp: raw.timestamp,
      ts,
      kind: "summary",
      preview: raw.summary ?? "",
    };
  }
  const blocks = normalizeContent(raw.message?.content);
  const toolUseBlock = blocks.find((b) => b.type === "tool_use");
  const toolResultBlock = blocks.find((b) => b.type === "tool_result");
  if (toolUseBlock?.type === "tool_use") {
    return {
      raw,
      timestamp: raw.timestamp,
      ts,
      kind: "tool_use",
      toolName: toolUseBlock.name,
      preview: previewToolInput(toolUseBlock.input),
      text: fullToolInput(toolUseBlock.input),
      sidechain: raw.isSidechain,
    };
  }
  if (toolResultBlock?.type === "tool_result") {
    return {
      raw,
      timestamp: raw.timestamp,
      ts,
      kind: "tool_result",
      preview: previewToolResult(toolResultBlock.content, toolResultBlock.is_error),
      text: fullToolResult(toolResultBlock.content, toolResultBlock.is_error),
      sidechain: raw.isSidechain,
    };
  }
  const text = collectText(blocks) || asText(raw.message?.content);
  return {
    raw,
    timestamp: raw.timestamp,
    ts,
    kind: baseKind,
    preview: truncate(text, 320),
    text: text || undefined,
    model: raw.message?.model,
    sidechain: raw.isSidechain,
  };
}

function classifyKind(raw: RawEvent): ParsedEvent["kind"] {
  if (raw.type === "user") return "user";
  if (raw.type === "assistant") return "assistant";
  if (raw.type === "system") return "system";
  if (raw.type === "summary") return "summary";
  return "other";
}

function collectText(blocks: ContentBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    if (b.type === "thinking" && typeof b.thinking === "string") {
      parts.push(`[thinking] ${b.thinking}`);
    }
  }
  return parts.join("\n");
}

function asText(content: unknown): string {
  if (typeof content === "string") return content;
  return "";
}

/** tool_use input을 절단 없이 JSON pretty-print으로 반환. */
function fullToolInput(input: unknown): string {
  if (input === undefined || input === null) return "";
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

/** tool_result content를 절단 없이 평탄한 텍스트로 반환. error prefix 포함. */
function fullToolResult(content: unknown, isError?: boolean): string {
  const prefix = isError ? "❌ " : "";
  if (typeof content === "string") return prefix + content;
  if (Array.isArray(content)) {
    const text = content
      .map((c) =>
        typeof c === "object" && c !== null && "text" in c
          ? String((c as { text?: unknown }).text ?? "")
          : "",
      )
      .filter(Boolean)
      .join("\n");
    return prefix + text;
  }
  try {
    return prefix + JSON.stringify(content, null, 2);
  } catch {
    return prefix + String(content);
  }
}

function previewToolInput(input: unknown): string {
  if (input === undefined || input === null) return "";
  try {
    const json = JSON.stringify(input);
    return truncate(json, 320);
  } catch {
    return String(input);
  }
}

function previewToolResult(content: unknown, isError?: boolean): string {
  const prefix = isError ? "❌ " : "";
  if (typeof content === "string") return prefix + truncate(content, 320);
  if (Array.isArray(content)) {
    const text = content
      .map((c) =>
        typeof c === "object" && c !== null && "text" in c
          ? String((c as { text?: unknown }).text ?? "")
          : "",
      )
      .filter(Boolean)
      .join("\n");
    return prefix + truncate(text, 320);
  }
  try {
    return prefix + truncate(JSON.stringify(content), 320);
  } catch {
    return prefix + String(content);
  }
}

function computeStats(events: ParsedEvent[]): SessionStats {
  const stats: SessionStats = {
    total: events.length,
    user: 0,
    assistant: 0,
    toolUse: 0,
    toolResult: 0,
  };
  for (const ev of events) {
    if (ev.kind === "user") stats.user += 1;
    else if (ev.kind === "assistant") {
      stats.assistant += 1;
      if (ev.model) stats.lastModel = ev.model;
    } else if (ev.kind === "tool_use") stats.toolUse += 1;
    else if (ev.kind === "tool_result") stats.toolResult += 1;
    if (ev.ts) {
      if (!stats.firstTs || ev.ts < stats.firstTs) stats.firstTs = ev.ts;
      if (!stats.lastTs || ev.ts > stats.lastTs) stats.lastTs = ev.ts;
    }
  }
  return stats;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}
