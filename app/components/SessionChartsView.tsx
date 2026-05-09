"use client";

import { useMemo, useState } from "react";
import {
  KIND_LABEL,
  buildTicks,
  formatRange,
  formatStamp,
  niceCeil,
  type ParsedEvent,
  type SessionStats,
} from "./session-log-shared";

type TimeBin = { start: number; end: number; count: number };

type ChartsProps = {
  /** 시각화할 파싱된 이벤트들. */
  events: ParsedEvent[];
  /** 미리 계산된 통계. */
  stats: SessionStats;
};

/**
 * 세션 통계 차트 묶음(시간대별 활동량·도구 사용·이벤트 종류 비율).
 * 무거운 계산을 가지고 있어 React.lazy로 동적 import — 디폴트 export 유지.
 */
export default function SessionChartsView({ events, stats }: ChartsProps) {
  const buckets = useMemo(() => bucketByTime(events, stats), [events, stats]);
  const tools = useMemo(() => topTools(events, 8), [events]);
  const kindCounts = useMemo(() => countByKind(events), [events]);

  return (
    <div className="flex flex-col gap-4">
      <ChartCard title="시간대별 활동량" subtitle={`${buckets.bins.length}개 구간`}>
        {buckets.bins.length > 0 ? (
          <ActivityBars bins={buckets.bins} />
        ) : (
          <EmptyChart message="타임스탬프가 있는 이벤트가 부족합니다." />
        )}
      </ChartCard>
      <ChartCard title="이벤트 타입 분포" subtitle={`총 ${events.length}건`}>
        <KindBars counts={kindCounts} />
      </ChartCard>
      <ChartCard title="도구 사용 빈도" subtitle={`상위 ${tools.length}개`}>
        {tools.length > 0 ? (
          <ToolBars tools={tools} />
        ) : (
          <EmptyChart message="도구 호출이 없습니다." />
        )}
      </ChartCard>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h5 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
          {title}
        </h5>
        {subtitle && (
          <span className="text-[10px] text-zinc-500">{subtitle}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="py-3 text-center text-[11px] text-zinc-500">{message}</div>
  );
}

function ActivityBars({ bins }: { bins: TimeBin[] }) {
  const [hover, setHover] = useState<TimeBin | null>(null);
  const rawMax = Math.max(...bins.map((b) => b.count), 1);
  const niceMax = niceCeil(rawMax);
  const total = bins.reduce((a, b) => a + b.count, 0);
  const ticks = buildTicks(niceMax, 4);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-500">
        <span>y축: 구간당 이벤트 수</span>
        <span>
          총 <span className="font-mono">{total}</span>건
        </span>
      </div>
      <div className="flex gap-1">
        <div className="relative h-24 w-8 shrink-0">
          {ticks.map((t, i) => {
            const pct = (t / niceMax) * 100;
            const isTop = i === ticks.length - 1;
            const isBottom = i === 0;
            const positional: React.CSSProperties = isTop
              ? { top: 0 }
              : isBottom
                ? { bottom: 0 }
                : { bottom: `${pct}%`, transform: "translateY(50%)" };
            return (
              <span
                key={t}
                className="absolute right-0 pr-1 text-right font-mono text-[10px] leading-none text-zinc-500"
                style={positional}
              >
                {t}
              </span>
            );
          })}
        </div>
        <div className="relative flex h-24 flex-1 items-stretch gap-[1px] rounded-md border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-900">
          {ticks.slice(1).map((t) => (
            <div
              key={t}
              aria-hidden
              className="pointer-events-none absolute inset-x-1 border-t border-dashed border-zinc-300 dark:border-zinc-800"
              style={{ bottom: `${(t / niceMax) * 100}%` }}
            />
          ))}
          {bins.map((b, i) => {
            const pct = (b.count / niceMax) * 100;
            const active = hover === b;
            return (
              <div
                key={i}
                onMouseEnter={() => setHover(b)}
                onMouseLeave={() => setHover((h) => (h === b ? null : h))}
                className="relative flex flex-1 items-end"
                title={`${formatRange(b.start, b.end)} — ${b.count}건`}
              >
                <div
                  className={
                    active
                      ? "w-full rounded-sm bg-sky-500"
                      : "w-full rounded-sm bg-zinc-700 dark:bg-zinc-300"
                  }
                  style={{ height: `${pct}%`, minHeight: b.count > 0 ? 2 : 0 }}
                />
              </div>
            );
          })}
        </div>
      </div>
      <XAxisTicks
        start={bins[0].start}
        end={bins[bins.length - 1].end}
      />
      <div className="ml-9 mt-1 h-4 text-[11px] text-zinc-600 dark:text-zinc-400">
        {hover ? (
          <span>
            <span className="font-mono">{formatRange(hover.start, hover.end)}</span>
            {" — "}
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              {hover.count}건
            </span>
          </span>
        ) : (
          <span className="text-zinc-400">막대에 마우스를 올려 자세히 보기</span>
        )}
      </div>
    </div>
  );
}

function XAxisTicks({ start, end }: { start: number; end: number }) {
  const COUNT = 5;
  const ticks = Array.from({ length: COUNT }, (_, i) => {
    const ratio = i / (COUNT - 1);
    return { ratio, ts: start + (end - start) * ratio };
  });
  return (
    <div className="ml-9 mt-1 h-3.5">
      <div className="relative h-full">
        {ticks.map((t, i) => {
          const isFirst = i === 0;
          const isLast = i === ticks.length - 1;
          const positional: React.CSSProperties = isFirst
            ? { left: 0 }
            : isLast
              ? { right: 0 }
              : { left: `${t.ratio * 100}%`, transform: "translateX(-50%)" };
          return (
            <span
              key={i}
              className="absolute top-0 whitespace-nowrap font-mono text-[10px] text-zinc-500"
              style={positional}
            >
              {formatStamp(t.ts)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

const KIND_BAR_TONE: Record<ParsedEvent["kind"], string> = {
  user: "bg-zinc-500",
  assistant: "bg-emerald-500",
  tool_use: "bg-sky-500",
  tool_result: "bg-amber-500",
  summary: "bg-violet-500",
  system: "bg-zinc-400",
  other: "bg-zinc-300",
};

function KindBars({ counts }: { counts: Record<ParsedEvent["kind"], number> }) {
  const entries = Object.entries(counts).filter(([, n]) => n > 0) as [
    ParsedEvent["kind"],
    number,
  ][];
  const total = entries.reduce((a, [, n]) => a + n, 0) || 1;
  return (
    <ul className="flex flex-col gap-1.5">
      {entries.map(([kind, n]) => (
        <li key={kind} className="flex items-center gap-2 text-[11px]">
          <span className="w-20 shrink-0 text-zinc-600 dark:text-zinc-300">
            {KIND_LABEL[kind]}
          </span>
          <div className="flex-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-900">
            <div
              className={`h-3 ${KIND_BAR_TONE[kind]}`}
              style={{ width: `${(n / total) * 100}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right font-mono text-zinc-500">
            {n}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ToolBars({ tools }: { tools: { name: string; count: number }[] }) {
  const max = tools[0]?.count ?? 1;
  return (
    <ul className="flex flex-col gap-1.5">
      {tools.map((t) => (
        <li key={t.name} className="flex items-center gap-2 text-[11px]">
          <span className="w-28 shrink-0 truncate font-mono text-zinc-700 dark:text-zinc-200">
            {t.name}
          </span>
          <div className="flex-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-900">
            <div
              className="h-3 bg-sky-500"
              style={{ width: `${(t.count / max) * 100}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right font-mono text-zinc-500">
            {t.count}
          </span>
        </li>
      ))}
    </ul>
  );
}

function bucketByTime(
  events: ParsedEvent[],
  stats: SessionStats,
): { bins: TimeBin[] } {
  if (!stats.firstTs || !stats.lastTs || stats.firstTs === stats.lastTs) {
    return { bins: [] };
  }
  const BUCKETS = 30;
  const span = stats.lastTs - stats.firstTs;
  const bucketMs = Math.max(1, Math.ceil(span / BUCKETS));
  const bins: TimeBin[] = Array.from({ length: BUCKETS }, (_, i) => ({
    start: stats.firstTs! + i * bucketMs,
    end: stats.firstTs! + (i + 1) * bucketMs,
    count: 0,
  }));
  for (const ev of events) {
    if (!ev.ts) continue;
    const idx = Math.min(
      BUCKETS - 1,
      Math.floor((ev.ts - stats.firstTs) / bucketMs),
    );
    bins[idx].count += 1;
  }
  return { bins };
}

function topTools(
  events: ParsedEvent[],
  limit: number,
): { name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const ev of events) {
    if (ev.kind !== "tool_use" || !ev.toolName) continue;
    map.set(ev.toolName, (map.get(ev.toolName) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function countByKind(events: ParsedEvent[]): Record<ParsedEvent["kind"], number> {
  const out: Record<ParsedEvent["kind"], number> = {
    user: 0,
    assistant: 0,
    tool_use: 0,
    tool_result: 0,
    summary: 0,
    system: 0,
    other: 0,
  };
  for (const ev of events) out[ev.kind] += 1;
  return out;
}
