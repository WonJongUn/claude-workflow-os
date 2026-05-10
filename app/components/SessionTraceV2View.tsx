"use client";

import { memo, useMemo, useState } from "react";
import { LazyMarkdown } from "./LazyMarkdown";
import { SessionCodeBlock } from "./SessionCodeBlock";
import { SessionDiffBlock } from "./SessionDiffBlock";
import { cn, Tooltip } from "./ui";
import {
  SPAN_KIND_TOOLTIP,
  extractEditChanges,
  extractToolUseId,
  formatDuration,
  normalizeContent,
  type ContentBlock,
  type ParsedEvent,
} from "./session-log-shared";

/**
 * Trace V2 — Datadog 스타일 waterfall.
 *
 * 모델: 세션 전체 = 1 trace, 사용자 턴 = root span,
 * 턴 안의 어시스턴트 텍스트와 도구 호출(↔결과)이 child span.
 * sidechain(서브에이전트) 도구 호출은 한 단계 더 들여쓴 child span.
 *
 * 레이아웃: 좌측 이름 컬럼(트리) + 우측 시간축에 절대 위치 막대.
 * 막대 클릭 시 하단에 상세 패널(input/output/diff).
 */

/**
 * waterfall 한 행. 트레이스 안에서 시간축에 막대로 그려진다.
 * `endMs === startMs`면 점 이벤트(어시스턴트 텍스트 등) — 렌더 시 최소폭 보장.
 */
type SpanV2 = {
  /** span 식별자(이벤트 uuid 또는 합성 키). */
  id: string;
  /** 부모 span id. root 턴 span은 null. */
  parentId: string | null;
  /** 트리 들여쓰기 깊이. 0 = 턴, 1 = 도구/어시스턴트, 2 = sidechain 도구. */
  depth: number;
  /** 행 좌측 이름 라벨. */
  label: string;
  /** 시각 분류 — 색상/아이콘에 매핑. */
  kind: "turn" | "assistant" | "tool" | "sidechain";
  /** 트레이스 절대 시작 (epoch ms). */
  startMs: number;
  /** 트레이스 절대 끝 (epoch ms). 점 이벤트는 startMs 와 같다. */
  endMs: number;
  /** 도구 호출 시 도구 이름. 검색·필터에 사용. */
  toolName?: string;
  /** 도구 결과가 is_error true 였는지. */
  isError?: boolean;
  /** 상세 패널 본문 출처. */
  event: ParsedEvent;
  /** 도구 결과 이벤트(있을 때). 상세 패널에 같이 표시. */
  resultEvent?: ParsedEvent;
  /**
   * 서브에이전트(sidechain) span에서 어느 서브에이전트의 작업인지 식별하는 짧은 라벨.
   * 부모 Agent의 input에서 파생: TeamCreate spawn은 `name`, 일반 spawn은 `subagent_type` 또는 description 첫 단어.
   * sidechain이 아닌 span은 undefined.
   */
  subagentLabel?: string;
};

/** 트레이스 단위 메타. 세션 1개 = 1 트레이스. */
type TraceV2 = {
  /** 세션 id (= trace id). */
  traceId: string;
  /** 트레이스 절대 시작 (epoch ms). 모든 span의 left 계산 기준. */
  startMs: number;
  /** 트레이스 절대 끝 (epoch ms). 모든 span의 width 계산 기준. */
  endMs: number;
  /** depth-first 순으로 평탄화된 span 목록. */
  spans: SpanV2[];
};

/**
 * V2 트레이스 뷰 — turn 루트 + 그 아래 assistant/tool 자식 span의 nested 시각화.
 * 서브에이전트도 부모 Task span 아래로 nesting된다. React.lazy 동적 import.
 */
export default function SessionTraceV2View({
  events,
  sessionId,
  subagentParents,
}: {
  events: ParsedEvent[];
  /** 세션 id. trace id로 헤더에 노출. */
  sessionId: string;
  /** 서버가 미리 계산한 agentId → 부모 Agent tool_use_id 매핑. nesting에 사용. */
  subagentParents: Record<string, string>;
}) {
  const trace = useMemo(
    () => buildTrace(events, sessionId, subagentParents),
    [events, sessionId, subagentParents],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /**
   * 사용자가 명시적으로 토글한 span의 의도된 상태 (true=접힘, false=펼침).
   * 미존재 키는 *기본값* — 턴은 마지막을 제외하고 접힘, 그 외는 펼침.
   * 새 턴이 들어와도 사용자가 토글한 항목은 유지되고 새 항목엔 기본값이 적용된다.
   */
  const [userOverride, setUserOverride] = useState<Map<string, boolean>>(
    () => new Map(),
  );
  const selected = useMemo(
    () => trace?.spans.find((s) => s.id === selectedId) ?? null,
    [trace, selectedId],
  );
  /** span id → 자식 보유 여부. 토글 인디케이터·접기 가능 여부 판정. */
  const childCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of trace?.spans ?? []) {
      if (!s.parentId) continue;
      m.set(s.parentId, (m.get(s.parentId) ?? 0) + 1);
    }
    return m;
  }, [trace]);
  /** span id → 부모 id. 접힘 판정에서 조상 체인을 빠르게 walk-up. */
  const parentMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of trace?.spans ?? []) {
      if (s.parentId) m.set(s.id, s.parentId);
    }
    return m;
  }, [trace]);
  /**
   * 현재 접힌 span 집합. 트레이스 + 사용자 override로부터 매 렌더 derive.
   * 기본 정책: turn 종류 span 중 마지막 turn만 펼치고 나머지는 접힘.
   * 그 외 종류(tool 등)는 기본 펼침. 사용자 override가 있으면 그 값 우선.
   */
  const collapsed = useMemo(() => {
    const result = new Set<string>();
    if (!trace) return result;
    const turns = trace.spans.filter((s) => s.kind === "turn");
    if (turns.length > 1) {
      for (const t of turns.slice(0, -1)) result.add(t.id);
    }
    for (const [id, want] of userOverride) {
      if (want) result.add(id);
      else result.delete(id);
    }
    return result;
  }, [trace, userOverride]);
  /**
   * span 클릭 핸들러. 우측 상세 드로어를 여는 동시에,
   * 자식 있는 span이면 접기 토글도 같이 동작 — userOverride에 반대 상태로 기록.
   */
  const handleSelect = (s: SpanV2) => {
    setSelectedId(s.id);
    if ((childCount.get(s.id) ?? 0) === 0) return;
    const currentlyCollapsed = collapsed.has(s.id);
    setUserOverride((prev) => {
      const next = new Map(prev);
      next.set(s.id, !currentlyCollapsed);
      return next;
    });
  };
  const visibleSpans = useMemo(() => {
    if (!trace) return [];
    if (collapsed.size === 0) return trace.spans;
    return trace.spans.filter((s) => {
      // 조상 체인 중 하나라도 접혀 있으면 숨김.
      let p = s.parentId;
      while (p) {
        if (collapsed.has(p)) return false;
        p = parentMap.get(p) ?? null;
      }
      return true;
    });
  }, [trace, collapsed, parentMap]);

  if (!trace || trace.spans.length === 0) {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        트레이스로 묶을 이벤트가 없습니다.
      </div>
    );
  }

  const totalMs = Math.max(1, trace.endMs - trace.startMs);
  const open = selected !== null;
  const turnSpans = trace.spans.filter((s) => s.kind === "turn");
  const allTurnsCollapsed =
    turnSpans.length > 0 && turnSpans.every((t) => collapsed.has(t.id));
  /**
   * 모든 turn span 의 userOverride 를 한 번에 세팅. 접기 = true, 펴기 = false 를
   * 모든 turn id 에 대해 명시적으로 기록 — 기본 정책(마지막 turn 만 펼침)을 넘어 일괄 적용.
   */
  const toggleAllTurns = () => {
    const want = !allTurnsCollapsed;
    setUserOverride((prev) => {
      const next = new Map(prev);
      for (const t of turnSpans) next.set(t.id, want);
      return next;
    });
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <TraceHeader trace={trace} />
        {turnSpans.length > 1 && (
          <button
            type="button"
            onClick={toggleAllTurns}
            className="shrink-0 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
            title={
              allTurnsCollapsed
                ? "모든 턴을 펼쳐 자손 span 을 표시"
                : "모든 턴을 접어 헤드라인만 표시"
            }
          >
            {allTurnsCollapsed ? "▾ 모든 턴 펴기" : "▸ 모든 턴 접기"}
          </button>
        )}
      </div>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <TimeAxis totalMs={totalMs} />
          <ol className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {visibleSpans.map((s) => (
              <SpanRow
                key={s.id}
                span={s}
                traceStart={trace.startMs}
                totalMs={totalMs}
                selected={selectedId === s.id}
                hasChildren={(childCount.get(s.id) ?? 0) > 0}
                collapsed={collapsed.has(s.id)}
                onSelect={handleSelect}
              />
            ))}
          </ol>
        </div>
        {/*
          드로어: 미선택 시 폭 0으로 줄여 사라지고, 선택 시 clamp 범위 내 폭으로 펼친다.
          내부 패널은 같은 폭을 inline style로 고정해 width 트랜지션 중에도
          내부 콘텐츠가 reflow되지 않는다(코드 블록이 압착되며 깨지는 현상 방지).
        */}
        {/*
          드로어: 트레이스 옆 인라인 컬럼. 닫힘 = 폭 0 (트레이스가 최대 폭으로 펼침),
          열림 = DRAWER_WIDTH 만큼 폭 확장 → 트레이스가 그만큼 줄어든다.
          행 리스트가 길어 페이지가 스크롤돼도 패널이 뷰포트 안에 머무르도록 sticky.
          상단 탭바(SessionPanel sticky top-0, z-20) 아래로 비키도록 top-14 +
          height calc(100vh - 4rem). overflow-hidden 으로 width 트랜지션 중 내부
          코드 블록이 reflow 되지 않게 (안쪽 div 가 DRAWER_WIDTH 고정).
        */}
        <div
          className="sticky top-14 shrink-0 self-start overflow-hidden transition-[width] duration-300 ease-out"
          style={{
            width: open ? DRAWER_WIDTH : "0px",
            height: "calc(100vh - 4rem)",
          }}
          aria-hidden={!open}
        >
          <div className="h-full" style={{ width: DRAWER_WIDTH }}>
            {selected && (
              <SpanDetail
                span={selected}
                onClose={() => setSelectedId(null)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TraceHeader({ trace }: { trace: TraceV2 }) {
  const duration = trace.endMs - trace.startMs;
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-xs">
      <Stat
        label="trace id"
        value={trace.traceId}
        mono
      />
      <Stat
        label="span"
        value={String(trace.spans.length)}
      />
      <Stat
        label="기간"
        value={duration > 0 ? formatDuration(duration) : "—"}
      />
      <Stat
        label="시작"
        value={new Date(trace.startMs).toLocaleString()}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </dt>
      <dd
        className={cn(
          "text-zinc-900 dark:text-zinc-100",
          mono && "font-mono text-[11px]",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

const NAME_COL = "w-72";
const TICKS = 10;
/**
 * 우측 상세 드로어의 펼친 폭. 휠 스크롤 시 세로 스크롤바 등장/소멸로 vw 가 미세하게
 * 변하면 폭이 떨림 — 코드 블록 가독성에 충분한 고정 폭(40rem)으로 못박는다.
 */
const DRAWER_WIDTH = "40rem";

function TimeAxis({ totalMs }: { totalMs: number }) {
  const ticks = Array.from({ length: TICKS + 1 }, (_, i) => i);
  return (
    <div className="flex border-b border-zinc-200 bg-zinc-50 text-[10px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
      <div className={cn(NAME_COL, "shrink-0 px-3 py-1.5")}>span</div>
      <div className="relative flex-1 px-2 py-1.5">
        {ticks.map((i) => {
          const pct = (i / TICKS) * 100;
          const ms = (totalMs * i) / TICKS;
          // 양 끝은 부모 안쪽으로 anchor — 0%, 100%에서 라벨이 잘려 나가지 않게.
          // absolute positioning은 padding을 무시하므로 inset 값을 명시적으로 둔다.
          const positional: React.CSSProperties =
            i === 0
              ? { left: "0.5rem" }
              : i === TICKS
                ? { right: "0.5rem" }
                : { left: `${pct}%`, transform: "translateX(-50%)" };
          return (
            <span
              key={i}
              className="absolute top-1.5 whitespace-nowrap font-mono tabular-nums"
              style={positional}
            >
              {formatTickMs(ms)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** waterfall 시간 라벨 — 짧으면 ms, 길면 s/m 단위. */
function formatTickMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

const KIND_BAR: Record<SpanV2["kind"], string> = {
  turn: "bg-zinc-400 dark:bg-zinc-500",
  assistant: "bg-emerald-400 dark:bg-emerald-500",
  tool: "bg-sky-400 dark:bg-sky-500",
  sidechain: "bg-violet-400 dark:bg-violet-500",
};

const KIND_LABEL_V2: Record<SpanV2["kind"], string> = {
  turn: "턴",
  assistant: "어시스턴트",
  tool: "도구",
  sidechain: "서브에이전트",
};

const SpanRow = memo(function SpanRow({
  span,
  traceStart,
  totalMs,
  selected,
  hasChildren,
  collapsed,
  onSelect,
}: {
  span: SpanV2;
  traceStart: number;
  totalMs: number;
  selected: boolean;
  /** 자식 span이 하나라도 있으면 true — 토글 인디케이터를 표시. */
  hasChildren: boolean;
  /** 자식이 접혀 있는지. 펼침/접힘 표시용. */
  collapsed: boolean;
  onSelect: (span: SpanV2) => void;
}) {
  const offsetPct = ((span.startMs - traceStart) / totalMs) * 100;
  const widthMs = Math.max(0, span.endMs - span.startMs);
  // 점 이벤트는 0폭이 되어 안 보이므로 최소 0.4% 보장.
  const widthPct = Math.max((widthMs / totalMs) * 100, 0.4);
  // 막대가 우측을 넘지 않게 clamp.
  const clampedWidth = Math.min(widthPct, 100 - offsetPct);
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(span)}
        className={cn(
          "flex w-full items-center text-left text-xs transition-colors",
          selected
            ? "bg-zinc-100 dark:bg-zinc-900"
            : "hover:bg-zinc-50 dark:hover:bg-zinc-900/50",
        )}
      >
        <div
          className={cn(
            NAME_COL,
            "flex shrink-0 items-center gap-1.5 truncate px-3 py-1.5",
          )}
          style={{ paddingLeft: `${0.75 + span.depth * 0.875}rem` }}
        >
          {hasChildren ? (
            <span
              className="inline-block w-3 shrink-0 text-center font-mono text-[10px] text-zinc-500"
              aria-hidden
            >
              {collapsed ? "▸" : "▾"}
            </span>
          ) : (
            <span
              className={cn(
                "inline-block h-2 w-2 shrink-0 rounded-sm",
                KIND_BAR[span.kind],
              )}
              aria-hidden
            />
          )}
          <span
            className="truncate font-mono text-[11px] text-zinc-800 dark:text-zinc-200"
            title={span.label}
          >
            {span.label}
          </span>
          {span.isError && (
            <span className="rounded bg-red-100 px-1 text-[9px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
              error
            </span>
          )}
        </div>
        <div className="relative flex-1 px-2 py-1.5">
          <div className="relative h-4 w-full">
            <span
              className={cn(
                "absolute top-0 h-4 rounded-sm",
                KIND_BAR[span.kind],
                span.isError && "bg-red-400 dark:bg-red-500",
              )}
              style={{
                left: `${offsetPct}%`,
                width: `${clampedWidth}%`,
                minWidth: "2px",
              }}
            />
          </div>
        </div>
      </button>
    </li>
  );
});

/**
 * Agent/TeamCreate spawn 메타(team/name/subagent_type/agent_type)를 한 줄로 표시.
 * 해당 도구가 아닌 span에는 아무것도 렌더 안 함.
 */
function SpawnMetaRow({ event }: { event: ParsedEvent }) {
  const meta = spawnMeta(event);
  if (!meta) return null;
  const items: { label: string; value: string }[] = [];
  if (meta.team) items.push({ label: "Team", value: meta.team });
  if (meta.name) items.push({ label: "Name", value: meta.name });
  if (meta.agentType) items.push({ label: "Type", value: meta.agentType });
  if (meta.subagentType && !meta.agentType)
    items.push({ label: "Subagent", value: meta.subagentType });
  if (items.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
      {items.map((it) => (
        <span
          key={it.label}
          className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        >
          <span className="text-zinc-500 dark:text-zinc-500">{it.label}</span>
          {": "}
          {it.value}
        </span>
      ))}
    </div>
  );
}

function SpanDetail({
  span,
  onClose,
}: {
  span: SpanV2;
  onClose: () => void;
}) {
  const changes = useMemo(() => extractEditChanges(span.event), [span.event]);
  const hasDiff = changes.changes.length > 0;
  const duration = span.endMs - span.startMs;
  const isAskUserQuestion = span.toolName === "AskUserQuestion";
  /**
   * AskUserQuestion span 은 시각화 카드만 기본 표시하고 raw input/result JSON 은 토글로 펼친다.
   * 일반 도구 span 은 항상 raw 만 보이므로 영향 없음 (true 고정 동작).
   */
  const [showRaw, setShowRaw] = useState(false);
  const showRawSections = !isAskUserQuestion || showRaw;
  return (
    <div className="flex h-full flex-col rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px]">
            <Tooltip content={SPAN_KIND_TOOLTIP[span.kind]}>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-medium uppercase tracking-wider",
                  span.kind === "tool"
                    ? "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
                    : span.kind === "sidechain"
                      ? "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
                      : span.kind === "assistant"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
                )}
              >
                {KIND_LABEL_V2[span.kind]}
              </span>
            </Tooltip>
            <span className="font-mono text-zinc-600 dark:text-zinc-400">
              {span.label}
            </span>
            {duration > 0 && (
              <span className="font-mono text-zinc-500">
                {formatDuration(duration)}
              </span>
            )}
          </div>
          {span.subagentLabel && (
            <div className="mt-1 flex items-center gap-1.5 text-[10px]">
              <span className="text-zinc-500">소속</span>
              <span className="rounded bg-violet-100 px-1.5 py-0.5 font-mono text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                {span.subagentLabel}
              </span>
            </div>
          )}
          <SpawnMetaRow event={span.event} />
          <div className="mt-0.5 font-mono text-[10px] text-zinc-500">
            {new Date(span.startMs).toLocaleString()}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="상세 닫기"
          title="상세 닫기"
          className="rounded-md border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          ✕
        </button>
      </div>
      <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 text-xs text-zinc-800 dark:text-zinc-200">
        {span.kind === "assistant" && span.event.text && (
          <LazyMarkdown text={span.event.text} />
        )}
        {(span.kind === "tool" || span.kind === "sidechain") && (
          <>
            {isAskUserQuestion && (
              <>
                <AskUserQuestionView
                  useEvent={span.event}
                  resultEvent={span.resultEvent}
                />
                <button
                  type="button"
                  onClick={() => setShowRaw((v) => !v)}
                  className="self-start rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  {showRaw ? "▾ raw JSON 접기" : "▸ raw JSON 자세히 보기"}
                </button>
              </>
            )}
            {showRawSections && (
              <>
                {span.event.text ? (
                  <SessionCodeBlock text={span.event.text} language="json" />
                ) : (
                  <div className="text-zinc-500">{span.event.preview}</div>
                )}
                {span.resultEvent && (
                  <div>
                    <div className="mb-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
                      ↳ 결과
                    </div>
                    {span.resultEvent.text ? (
                      <SessionCodeBlock text={span.resultEvent.text} />
                    ) : (
                      <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                        {span.resultEvent.preview}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
            {hasDiff && (
              <SessionDiffBlock
                filePath={changes.filePath}
                changes={changes.changes}
              />
            )}
          </>
        )}
        {span.kind === "turn" && span.event.text && (
          <LazyMarkdown text={span.event.text} />
        )}
      </div>
    </div>
  );
}

/**
 * AskUserQuestion 도구 호출의 입력에 들어가는 한 질문.
 * Anthropic의 AskUserQuestion 스펙과 동일한 모양 (jsonl input 그대로).
 */
type AskUserQuestion = {
  /** 사용자에게 보여줄 질문 본문. */
  question: string;
  /** 짧은 라벨/카테고리 (UI 헤더 칩). */
  header?: string;
  /** 다중 선택 허용 여부. */
  multiSelect?: boolean;
  /** 선택지. */
  options: { label: string; description?: string }[];
};

/**
 * AskUserQuestion tool_use input + tool_result 의 toolUseResult.answers 를 묶어
 * 질문별 선택된 옵션 라벨 set 으로 정규화. multiSelect 답변은 ", " 구분 문자열이지만
 * 라벨 자체에 ", " 가 들어있을 수 있으므로 옵션 라벨 매칭으로 안전하게 분해한다.
 */
function extractAskUserQuestion(
  useEvent: ParsedEvent,
  resultEvent: ParsedEvent | undefined,
): {
  questions: AskUserQuestion[];
  /** 질문 텍스트 → 선택된 옵션 라벨들. */
  selected: Record<string, Set<string>>;
} | null {
  const block = normalizeContent(useEvent.raw.message?.content).find(
    (b): b is ContentBlock & { type: "tool_use" } => b.type === "tool_use",
  );
  const input =
    block && typeof block.input === "object" && block.input !== null
      ? (block.input as { questions?: unknown })
      : null;
  if (!input || !Array.isArray(input.questions)) return null;
  const questions = input.questions.filter(
    (q): q is AskUserQuestion =>
      !!q &&
      typeof q === "object" &&
      typeof (q as AskUserQuestion).question === "string" &&
      Array.isArray((q as AskUserQuestion).options),
  );
  if (questions.length === 0) return null;

  const rawAnswers =
    (resultEvent?.raw as { toolUseResult?: { answers?: unknown } } | undefined)
      ?.toolUseResult?.answers;
  const answers =
    rawAnswers && typeof rawAnswers === "object"
      ? (rawAnswers as Record<string, unknown>)
      : {};

  const selected: Record<string, Set<string>> = {};
  for (const q of questions) {
    const ans = answers[q.question];
    const set = new Set<string>();
    if (typeof ans === "string" && ans.length > 0) {
      // 라벨 일치(전체 부분 문자열) 우선 — 라벨 안에 ", "가 있어도 안전.
      for (const opt of q.options) {
        if (ans === opt.label || ans.includes(opt.label)) set.add(opt.label);
      }
      // 라벨 매칭 실패 시 ", " split 으로 fallback.
      if (set.size === 0) {
        for (const part of ans.split(", ")) {
          const t = part.trim();
          if (t) set.add(t);
        }
      }
    }
    selected[q.question] = set;
  }
  return { questions, selected };
}

/**
 * AskUserQuestion span 의 입력/응답을 read-only 체크 UI 로 보여준다.
 * 단일 선택은 라디오, 다중 선택은 체크박스 모양(disabled). 선택된 옵션은 강조.
 */
function AskUserQuestionView({
  useEvent,
  resultEvent,
}: {
  /** AskUserQuestion tool_use 이벤트. */
  useEvent: ParsedEvent;
  /** 매칭된 tool_result 이벤트. 응답 전이면 undefined. */
  resultEvent?: ParsedEvent;
}) {
  const data = useMemo(
    () => extractAskUserQuestion(useEvent, resultEvent),
    [useEvent, resultEvent],
  );
  if (!data) return null;
  const answered = !!resultEvent;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
        <span>질문 / 응답</span>
        {!answered && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium normal-case text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            응답 대기
          </span>
        )}
      </div>
      <ol className="flex flex-col gap-3">
        {data.questions.map((q, qi) => {
          const sel = data.selected[q.question] ?? new Set<string>();
          const multi = q.multiSelect === true;
          return (
            <li
              key={`${qi}-${q.question}`}
              className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-[12px] font-medium text-zinc-900 dark:text-zinc-100">
                  {q.question}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {q.header && (
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-mono text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      {q.header}
                    </span>
                  )}
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500">
                    {multi ? "다중" : "단일"}
                  </span>
                </div>
              </div>
              <ul className="mt-2 flex flex-col gap-1.5">
                {q.options.map((opt, oi) => {
                  const checked = sel.has(opt.label);
                  return (
                    <li
                      key={`${oi}-${opt.label}`}
                      className={cn(
                        "flex items-start gap-2 rounded-md border px-2.5 py-1.5",
                        checked
                          ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40"
                          : "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center border text-[10px] leading-none",
                          multi ? "rounded-sm" : "rounded-full",
                          checked
                            ? "border-emerald-500 bg-emerald-500 text-white"
                            : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950",
                        )}
                        aria-hidden
                      >
                        {checked ? (multi ? "✓" : "●") : ""}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div
                          className={cn(
                            "text-[12px]",
                            checked
                              ? "font-medium text-emerald-900 dark:text-emerald-200"
                              : "text-zinc-800 dark:text-zinc-200",
                          )}
                        >
                          {opt.label}
                        </div>
                        {opt.description && (
                          <div className="mt-0.5 text-[11px] leading-snug text-zinc-600 dark:text-zinc-400">
                            {opt.description}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * 이벤트를 트레이스/스팬 트리로 변환한다.
 *
 * 트리 구성 규칙:
 * - 세션 = 1 trace, 사용자 메시지 = root span(턴).
 * - 비-서브에이전트 도구 호출/어시스턴트 텍스트는 턴의 직계 자식.
 * - 서브에이전트 이벤트는 raw.parentUuid 체인을 따라
 *   가장 가까운 tool_use 조상 아래로 nesting한다 (Task → 그 안의 도구들).
 *   조상이 없으면 턴 직계 자식으로 떨어진다.
 *
 * 출력 spans는 DFS 순회 결과 — 부모 바로 뒤에 자손이 따라온다.
 */
function buildTrace(
  events: ParsedEvent[],
  sessionId: string,
  subagentParents: Record<string, string>,
): TraceV2 | null {
  // 메인 + 서브에이전트 jsonl이 합쳐 들어와 file 순서로는 시간 역순일 수 있다.
  // 트레이스/턴 경계가 올바르려면 ts 기준 전역 정렬이 먼저.
  const timed = events
    .filter((e) => typeof e.ts === "number")
    .slice()
    .sort((a, b) => (a.ts as number) - (b.ts as number));
  if (timed.length === 0) return null;

  const resultsById = new Map<string, ParsedEvent>();
  for (const ev of timed) {
    if (ev.kind !== "tool_result") continue;
    const id = extractToolUseId(ev.raw, "tool_result");
    if (id) resultsById.set(id, ev);
  }

  // 서브에이전트 식별: 서버가 jsonl + .meta.json으로 미리 빌드한 agentId → 부모 Agent toolUseId 매핑.
  // 평탄 모델에서는 nesting에 쓰이지 않고, 행에 붙일 subagentLabel 칩을 만드는 데만 사용한다.
  const agentEventByToolUseId = new Map<string, ParsedEvent>();
  for (const ev of timed) {
    if (ev.kind !== "tool_use" || ev.sidechain === true) continue;
    if (ev.toolName !== "Agent") continue;
    const id = extractToolUseId(ev.raw, "tool_use");
    if (id) agentEventByToolUseId.set(id, ev);
  }
  const chipLabelByAgentId = new Map<string, string>();
  for (const [agentId, taskUseId] of Object.entries(subagentParents)) {
    const parentEv = agentEventByToolUseId.get(taskUseId);
    if (!parentEv) continue;
    const tag = subagentChipLabel(parentEv);
    if (tag) chipLabelByAgentId.set(agentId, tag);
  }

  const traceStart = timed[0].ts as number;
  const traceEnd = timed[timed.length - 1].ts as number;

  type Turn = {
    user?: ParsedEvent;
    events: ParsedEvent[];
    startMs: number;
  };
  const turns: Turn[] = [];
  let current: Turn | null = null;
  for (const ev of timed) {
    if (typeof ev.ts !== "number") continue;
    // 메인 thread의 user만 새 턴 시작점. 서브에이전트 user는 서브에이전트의 가짜 입력이라 합쳐서 처리.
    if (ev.kind === "user" && ev.sidechain !== true) {
      current = { user: ev, events: [], startMs: ev.ts };
      turns.push(current);
      continue;
    }
    if (!current) {
      // 첫 사용자 메시지 이전 이벤트(시스템/요약 등)는 자체 턴으로 묶는다.
      current = { events: [], startMs: ev.ts };
      turns.push(current);
    }
    current.events.push(ev);
  }

  const out: SpanV2[] = [];
  // trace 전체에 걸쳐 단조 증가하는 노드 카운터. span.id 합성 키에 사용해
  // 메인 + 다중 서브에이전트 jsonl 합본에서 같은 raw.uuid가 중복 등장해도 React key 충돌을 방지.
  let traceNodeIdx = 0;
  // 서버 매핑(agentId → 부모 Agent toolUseId). turn 안 nesting 복원에 사용.
  const taskUseIdByAgentId = new Map<string, string>(
    Object.entries(subagentParents),
  );

  turns.forEach((turn, i) => {
    const turnId = `turn-${i}`;

    // 1차: 노드 생성. tool_use_id → 메인 thread Agent 노드 인덱싱(같은 turn 안 sidechain 재배선용).
    const nodes: SpanNode[] = [];
    const nodeByToolUseId = new Map<string, SpanNode>();
    for (const ev of turn.events) {
      if (typeof ev.ts !== "number") continue;
      const node = makeNode(ev, turnId, traceNodeIdx++, resultsById);
      if (!node) continue;
      nodes.push(node);
      if (ev.kind === "tool_use" && ev.sidechain !== true) {
        const tuId = extractToolUseId(ev.raw, "tool_use");
        if (tuId && !nodeByToolUseId.has(tuId)) nodeByToolUseId.set(tuId, node);
      }
    }

    // 2차: 부모 결정. turn 안에서만 매칭하고 cross-turn은 turn 직계.
    // sidechain → 같은 turn의 부모 Agent toolUse 노드로. 못 찾으면 turn 직계.
    const turnRoot: SpanNode = {
      span: {} as SpanV2,
      children: [],
    };
    for (const node of nodes) {
      const ev = node.span.event;
      const isSide = ev.sidechain === true;
      let parent: SpanNode | undefined;
      if (isSide) {
        const agentId =
          typeof (ev.raw as { agentId?: unknown }).agentId === "string"
            ? ((ev.raw as { agentId?: string }).agentId ?? "")
            : "";
        if (agentId) {
          const taskUseId = taskUseIdByAgentId.get(agentId);
          if (taskUseId) parent = nodeByToolUseId.get(taskUseId);
          // 칩 라벨은 부모 노드가 같은 턴에 없어도 trace 레벨 맵에서 가져온다.
          const chip = chipLabelByAgentId.get(agentId);
          if (chip) node.span.subagentLabel = chip;
        }
      }
      if (parent) {
        node.span.parentId = parent.span.id;
        node.span.depth = parent.span.depth + 1;
        parent.children.push(node);
      } else {
        node.span.parentId = turnId;
        node.span.depth = 1;
        turnRoot.children.push(node);
      }
    }

    // 자식 정렬 + DFS 평탄화.
    sortChildrenDfs(turnRoot);

    // turn span 채움 — 자손까지 포함한 가장 늦은 endMs로 구간 계산.
    const deepEnd = deepestEnd(turnRoot, turn.startMs);
    const nextStart =
      i + 1 < turns.length ? turns[i + 1].startMs : traceEnd;
    const turnEnd = Math.max(deepEnd, Math.min(nextStart, traceEnd));
    const userText = turn.user?.text ?? turn.user?.preview ?? "";
    const label = userText ? truncateLabel(userText) : `턴 ${i + 1}`;
    turnRoot.span = {
      id: turnId,
      parentId: null,
      depth: 0,
      label: `턴 ${i + 1} · ${label}`,
      kind: "turn",
      startMs: turn.startMs,
      endMs: turnEnd,
      event:
        turn.user ??
        turnRoot.children[0]?.span.event ??
        ({ raw: {}, kind: "other", preview: "" } as ParsedEvent),
    };
    flattenDfs(turnRoot, out);
  });

  return {
    traceId: sessionId,
    startMs: traceStart,
    endMs: traceEnd,
    spans: out,
  };
}

/** 한 ParsedEvent에서 SpanV2 + Node를 만든다. parent/depth는 호출자가 채움. */
function makeNode(
  ev: ParsedEvent,
  turnId: string,
  /** trace 전체에 단조 증가하는 인덱스. span.id를 항상 unique하게 만든다 (raw.uuid 중복 회피). */
  nodeIdx: number,
  resultsById: Map<string, ParsedEvent>,
): SpanNode | null {
  if (typeof ev.ts !== "number") return null;
  if (ev.kind === "assistant") {
    return {
      span: {
        id: `n${nodeIdx}`,
        parentId: turnId,
        depth: 1,
        label: ev.model ?? "assistant",
        kind: "assistant",
        startMs: ev.ts,
        endMs: ev.ts,
        event: ev,
      },
      children: [],
    };
  }
  if (ev.kind === "tool_use") {
    const id = extractToolUseId(ev.raw, "tool_use");
    const result = id ? resultsById.get(id) : undefined;
    const endMs =
      result && typeof result.ts === "number" ? result.ts : ev.ts;
    const isError =
      result && (() => {
        const blocks = normalizeContent(result.raw.message?.content);
        const tr = blocks.find((b) => b.type === "tool_result");
        return tr?.type === "tool_result" && tr.is_error === true;
      })();
    const isSide = ev.sidechain === true;
    return {
      span: {
        id: `n${nodeIdx}`,
        parentId: turnId,
        depth: 1,
        label: toolLabel(ev),
        kind: isSide ? "sidechain" : "tool",
        startMs: ev.ts,
        endMs,
        toolName: ev.toolName,
        isError: Boolean(isError),
        event: ev,
        resultEvent: result,
      },
      children: [],
    };
  }
  return null;
}

/**
 * 트리에 표시할 도구 라벨. 좌측 행은 도구 이름만 — Team/Name/Type 같은 식별 필드는
 * 우측 상세 패널(SpanDetail)에서 노출한다 (좁은 행을 어지럽히지 않기 위함).
 */
function toolLabel(ev: ParsedEvent): string {
  return ev.toolName ?? "tool";
}

/**
 * Agent/TeamCreate spawn 정보 추출. 우측 상세 패널에서 표시.
 * Agent: `{ team?: string, name?: string, subagentType?: string }`
 * TeamCreate: `{ team?: string, agentType?: string }`
 * 외 도구는 null.
 */
function spawnMeta(ev: ParsedEvent): {
  team: string | null;
  name: string | null;
  subagentType: string | null;
  agentType: string | null;
} | null {
  const tool = ev.toolName ?? "";
  if (tool !== "Agent" && tool !== "TeamCreate") return null;
  const block = normalizeContent(ev.raw.message?.content).find(
    (b) => b.type === "tool_use",
  );
  const input =
    block && block.type === "tool_use"
      ? (block as { input?: unknown }).input
      : undefined;
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  return {
    team: typeof obj.team_name === "string" ? obj.team_name : null,
    name: typeof obj.name === "string" ? obj.name : null,
    subagentType:
      typeof obj.subagent_type === "string" ? obj.subagent_type : null,
    agentType: typeof obj.agent_type === "string" ? obj.agent_type : null,
  };
}

/**
 * 서브에이전트 행에 붙일 짧은 식별 칩 라벨. 부모 Agent tool_use input에서 파생.
 * 우선순위: input.name (TeamCreate) → input.subagent_type → input.description 첫 단어.
 * 길이 제한: 30자 (truncate). 전체 내용은 부모 Agent span을 펼쳐서 확인 가능.
 */
function subagentChipLabel(parentEvent: ParsedEvent): string | null {
  const block = normalizeContent(parentEvent.raw.message?.content).find(
    (b) => b.type === "tool_use",
  );
  const input =
    block && block.type === "tool_use"
      ? (block as { input?: unknown }).input
      : undefined;
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name : null;
  if (name) return truncateChip(name);
  const subType =
    typeof obj.subagent_type === "string" ? obj.subagent_type : null;
  const desc = typeof obj.description === "string" ? obj.description : null;
  if (subType && desc) return truncateChip(`${subType}: ${desc}`);
  if (subType) return truncateChip(subType);
  if (desc) return truncateChip(desc);
  return null;
}

function truncateChip(s: string): string {
  const trimmed = s.trim();
  return trimmed.length > 30 ? `${trimmed.slice(0, 29)}…` : trimmed;
}

type SpanNode = { span: SpanV2; children: SpanNode[] };

function sortChildrenDfs(n: SpanNode) {
  n.children.sort((a, b) => a.span.startMs - b.span.startMs);
  for (const c of n.children) sortChildrenDfs(c);
}

/** 노드와 모든 자손 중 가장 늦은 endMs. */
function deepestEnd(n: SpanNode, fallback: number): number {
  let m = n.span.endMs ?? fallback;
  for (const c of n.children) m = Math.max(m, deepestEnd(c, fallback));
  return m;
}

function flattenDfs(n: SpanNode, out: SpanV2[]) {
  out.push(n.span);
  for (const c of n.children) flattenDfs(c, out);
}

/** 한 줄 라벨로 줄여 표시 (최대 60자). 줄바꿈 → 공백. */
function truncateLabel(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length <= 60) return flat;
  return `${flat.slice(0, 60)}…`;
}
