"use client";

import { useState } from "react";
import { LazyMarkdown } from "./LazyMarkdown";
import { SessionCodeBlock } from "./SessionCodeBlock";
import {
  formatDuration,
  formatTime,
  type ParsedEvent,
  type SessionStats,
} from "./session-log-shared";

const SWIM_LANES: {
  key: ParsedEvent["kind"];
  label: string;
  fill: string;
}[] = [
  { key: "user", label: "사용자", fill: "fill-zinc-500" },
  { key: "assistant", label: "어시스턴트", fill: "fill-emerald-500" },
  { key: "tool_use", label: "도구", fill: "fill-sky-500" },
  { key: "tool_result", label: "결과", fill: "fill-amber-500" },
];

/**
 * 스윔레인 뷰: 종류별 행(사용자/어시스턴트/도구/결과 + 사이드체인) × 시간 축.
 * 각 이벤트는 시각에 비례한 x 좌표의 점으로 표시. hover 시 preview 표시.
 */
/** 사용자가 고를 수 있는 시간 축 간격. "auto"는 균등 6분할(이전 동작). */
type IntervalChoice = "auto" | "5m" | "10m" | "20m";
const INTERVAL_OPTIONS: { id: IntervalChoice; label: string }[] = [
  { id: "auto", label: "자동" },
  { id: "5m", label: "5분" },
  { id: "10m", label: "10분" },
  { id: "20m", label: "20분" },
];
const INTERVAL_MS: Record<Exclude<IntervalChoice, "auto">, number> = {
  "5m": 5 * 60_000,
  "10m": 10 * 60_000,
  "20m": 20 * 60_000,
};

export default function SessionSwimLaneView({
  events,
  stats,
}: {
  events: ParsedEvent[];
  stats: SessionStats;
}) {
  const [hover, setHover] = useState<ParsedEvent | null>(null);
  const [interval, setInterval] = useState<IntervalChoice>("auto");
  /**
   * interval = "5m"/"10m"/"20m" 이면 *마지막 N분* 만 보이도록 from을 lastTs - N으로 당긴다.
   * "auto"는 전체 범위. 점·tick·범위 텍스트 모두 이 잘린 범위에 맞춰 다시 그려진다.
   */
  const range =
    stats.firstTs && stats.lastTs && stats.lastTs > stats.firstTs
      ? interval === "auto"
        ? { from: stats.firstTs, to: stats.lastTs }
        : {
            from: Math.max(stats.firstTs, stats.lastTs - INTERVAL_MS[interval]),
            to: stats.lastTs,
          }
      : null;
  if (!range) {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        타임스탬프가 있는 이벤트가 부족합니다.
      </div>
    );
  }
  const laneH = 28;
  const labelW = 72;
  const pad = { t: 12, b: 12 };
  const hasSidechain = events.some((e) => e.sidechain);
  const lanes = hasSidechain
    ? [
        ...SWIM_LANES,
        { key: "_sidechain" as const, label: "사이드체인", fill: "fill-violet-500" },
      ]
    : SWIM_LANES;
  const height = pad.t + lanes.length * laneH + pad.b;
  const span = range.to - range.from;

  function pctFor(ts: number): number {
    return ((ts - range!.from) / span) * 100;
  }
  function laneIndexFor(ev: ParsedEvent): number | null {
    if (ev.sidechain && hasSidechain) return lanes.length - 1;
    const idx = SWIM_LANES.findIndex((l) => l.key === ev.kind);
    return idx < 0 ? null : idx;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] text-zinc-500">
          {new Date(range.from).toLocaleString()} ~{" "}
          {new Date(range.to).toLocaleString()} ·{" "}
          {formatDuration(range.to - range.from)}
        </div>
        <div className="inline-flex rounded-md border border-zinc-200 bg-white p-0.5 text-[11px] dark:border-zinc-800 dark:bg-zinc-950">
          {INTERVAL_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setInterval(o.id)}
              className={
                interval === o.id
                  ? "rounded bg-zinc-900 px-2 py-0.5 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "rounded px-2 py-0.5 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex w-full">
        <div
          className="shrink-0 text-[11px] text-zinc-600 dark:text-zinc-400"
          style={{ width: labelW, paddingTop: pad.t }}
        >
          {lanes.map((l) => (
            <div
              key={l.key}
              className="flex items-center justify-end pr-2"
              style={{ height: laneH }}
            >
              {l.label}
            </div>
          ))}
        </div>
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-md">
          <svg
            width="100%"
            height={height}
            role="img"
            aria-label="세션 스윔레인"
            className="block"
          >
            {lanes.map((_, i) => {
              const y = pad.t + i * laneH;
              return (
                <rect
                  key={i}
                  x={0}
                  y={y}
                  width="100%"
                  height={laneH}
                  className={
                    i % 2 === 0
                      ? "fill-zinc-50 dark:fill-zinc-900"
                      : "fill-white dark:fill-zinc-950"
                  }
                />
              );
            })}
            {events.map((ev, i) => {
              if (!ev.ts) return null;
              if (ev.ts < range!.from || ev.ts > range!.to) return null;
              const laneIdx = laneIndexFor(ev);
              if (laneIdx === null) return null;
              const y = pad.t + laneIdx * laneH + laneH / 2;
              const lane =
                ev.sidechain && hasSidechain
                  ? lanes[lanes.length - 1]
                  : SWIM_LANES.find((l) => l.key === ev.kind);
              if (!lane) return null;
              return (
                <circle
                  key={i}
                  cx={`${pctFor(ev.ts)}%`}
                  cy={y}
                  r={3.5}
                  className={`${lane.fill} cursor-pointer`}
                  onMouseEnter={() => setHover(ev)}
                  onMouseLeave={() => setHover((h) => (h === ev ? null : h))}
                />
              );
            })}
            <line
              x1={0}
              x2="100%"
              y1={pad.t + lanes.length * laneH}
              y2={pad.t + lanes.length * laneH}
              className="stroke-zinc-300 dark:stroke-zinc-700"
              strokeWidth={1}
            />
            {buildAxisTicks(range.from, range.to).map((t, i, all) => {
              const pct = ((t - range!.from) / span) * 100;
              const baseY = pad.t + lanes.length * laneH;
              return (
                <line
                  key={`tick-${i}`}
                  x1={`${pct}%`}
                  x2={`${pct}%`}
                  y1={baseY}
                  y2={baseY + (i === 0 || i === all.length - 1 ? 6 : 4)}
                  className="stroke-zinc-400 dark:stroke-zinc-600"
                  strokeWidth={1}
                />
              );
            })}
          </svg>
          <div className="relative mt-1 h-4 text-[10px] text-zinc-500">
            {buildAxisTicks(range.from, range.to).map((t, i, all) => {
              const pct = ((t - range!.from) / span) * 100;
              const isFirst = i === 0;
              const isLast = i === all.length - 1;
              const positional: React.CSSProperties = isFirst
                ? { left: 0 }
                : isLast
                  ? { right: 0 }
                  : { left: `${pct}%`, transform: "translateX(-50%)" };
              return (
                <span
                  key={`label-${i}`}
                  className="absolute whitespace-nowrap font-mono tabular-nums"
                  style={positional}
                >
                  {formatAxisLabel(t, range!.to - range!.from)}
                </span>
              );
            })}
          </div>
        </div>
      </div>
      {hover && <SwimHoverPanel event={hover} />}
    </div>
  );
}

/**
 * 스윔레인 점에 hover했을 때 본문을 풀로 보여주는 패널.
 * tool_use는 JSON 코드 블록, tool_result는 plain 코드 블록, user/assistant는 마크다운으로.
 */
function SwimHoverPanel({ event: ev }: { event: ParsedEvent }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 flex items-center gap-2 text-zinc-500">
        <span>{ev.kind}</span>
        {ev.toolName && <span className="font-mono">{ev.toolName}</span>}
        {ev.timestamp && (
          <span className="font-mono">{formatTime(ev.timestamp)}</span>
        )}
      </div>
      <div className="text-zinc-800 dark:text-zinc-200">
        {ev.kind === "tool_use" && ev.text ? (
          <SessionCodeBlock text={ev.text} language="json" />
        ) : ev.kind === "tool_result" && ev.text ? (
          <SessionCodeBlock text={ev.text} language="text" />
        ) : (ev.kind === "user" || ev.kind === "assistant") && ev.text ? (
          <LazyMarkdown text={ev.text} />
        ) : ev.text ? (
          <LazyMarkdown text={ev.text} />
        ) : ev.preview ? (
          <span className="break-words">{ev.preview}</span>
        ) : (
          <span className="text-zinc-400">—</span>
        )}
      </div>
    </div>
  );
}

/** 시간 축 tick — 양 끝 포함 균등 6분할. interval은 window 크기만 결정하고 tick에는 영향 없음. */
function buildAxisTicks(from: number, to: number): number[] {
  const COUNT = 6;
  const out: number[] = [];
  for (let i = 0; i < COUNT; i++) {
    out.push(from + ((to - from) * i) / (COUNT - 1));
  }
  return out;
}

/** 기간에 따라 시간 라벨 포맷을 다르게. 짧으면 초 단위, 길면 날짜 포함. */
function formatAxisLabel(ts: number, durationMs: number): string {
  const d = new Date(ts);
  const HH = String(d.getHours()).padStart(2, "0");
  const MM = String(d.getMinutes()).padStart(2, "0");
  const SS = String(d.getSeconds()).padStart(2, "0");
  if (durationMs < 60_000) return `${HH}:${MM}:${SS}`;
  if (durationMs < 24 * 60 * 60 * 1000) return `${HH}:${MM}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${HH}:${MM}`;
}
