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
  return (
    <div className="flex flex-col gap-3">
      <TraceHeader trace={trace} />
      <div className="flex items-stretch gap-3">
        <div className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <TimeAxis totalMs={totalMs} />
          <ol className="scroll-thin max-h-[60vh] overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-900">
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
        <div
          className="shrink-0 overflow-hidden transition-[width] duration-300 ease-out"
          style={{ width: open ? DRAWER_WIDTH : "0px" }}
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
 * 우측 상세 드로어의 펼친 폭. 코드 블록이 압착되지 않을 최소(28rem)와
 * 큰 화면에서도 트레이스 영역을 침범하지 않을 최대(44rem) 사이에서
 * 뷰포트 38vw로 비례 스케일링.
 */
const DRAWER_WIDTH = "clamp(28rem, 38vw, 44rem)";

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
          <span className="truncate font-mono text-[11px] text-zinc-800 dark:text-zinc-200">
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

  // 서버가 jsonl 필드 + .meta.json으로 미리 빌드한 안정적 매핑.
  // 텍스트 패턴(이전의 "agentId:" 정규식) 의존 제거 — 100% 매칭 가능.
  const taskUseIdByAgentId = new Map<string, string>(
    Object.entries(subagentParents),
  );

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

  turns.forEach((turn, i) => {
    const turnId = turn.user?.raw.uuid ?? `turn-${i}`;

    // 이 턴 안의 이벤트만 uuid → ParsedEvent 맵 (parentUuid 체인을 같은 턴 안에서만 따라감).
    const eventByUuid = new Map<string, ParsedEvent>();
    for (const ev of turn.events) {
      if (ev.raw.uuid) eventByUuid.set(ev.raw.uuid, ev);
    }

    // 1차: 각 이벤트의 노드 생성. parent는 일단 turn으로 두고 2차 패스에서 재배선.
    const nodeByEventUuid = new Map<string, SpanNode>();
    // tool_use 노드를 tool_use_id로도 색인 — 서브에이전트 첫 이벤트가 agentId로 부모 Task를 찾을 때 사용.
    const nodeByToolUseId = new Map<string, SpanNode>();
    let key = 0;
    for (const ev of turn.events) {
      if (typeof ev.ts !== "number") continue;
      const node = makeNode(ev, turnId, key++, resultsById);
      if (!node) continue;
      if (ev.raw.uuid) nodeByEventUuid.set(ev.raw.uuid, node);
      if (ev.kind === "tool_use") {
        const tuId = extractToolUseId(ev.raw, "tool_use");
        if (tuId) nodeByToolUseId.set(tuId, node);
      }
    }

    // 2차: 서브에이전트 노드의 부모를 parentUuid 체인을 따라 가장 가까운 *메인 thread* tool_use 조상으로 재배선.
    // 직전 서브에이전트 tool_use를 부모로 잡으면 한 서브에이전트 안의 Read N개가 끝없이 중첩되므로 건너뛴다.
    // 결과적으로 한 Task 아래 그 서브에이전트가 만진 모든 도구가 형제(flat)로 정렬된다.
    const turnRoot: SpanNode = {
      span: {} as SpanV2,
      children: [],
    };
    for (const node of nodeByEventUuid.values()) {
      const ev = node.span.event;
      const isSide = ev.sidechain === true;
      let parent: SpanNode | undefined;
      if (isSide) {
        // 우선 agentId로 부모 Task 직접 lookup. 서브에이전트 첫 이벤트는 parentUuid가 null이라 이게 유일한 경로.
        const agentId =
          typeof (ev.raw as { agentId?: unknown }).agentId === "string"
            ? ((ev.raw as { agentId?: string }).agentId ?? "")
            : "";
        if (agentId) {
          const taskUseId = taskUseIdByAgentId.get(agentId);
          if (taskUseId) parent = nodeByToolUseId.get(taskUseId);
        }
        // 폴백: parentUuid 체인을 따라 메인 thread의 tool_use 조상을 찾는다.
        if (!parent) {
          let cur: ParsedEvent | undefined = ev;
          const seen = new Set<string>();
          while (cur) {
            const pUuid = cur.raw.parentUuid;
            if (!pUuid || seen.has(pUuid)) break;
            seen.add(pUuid);
            const cand = nodeByEventUuid.get(pUuid);
            if (cand && cand.span.kind === "tool" && cand.span.event.sidechain !== true) {
              parent = cand;
              break;
            }
            cur = eventByUuid.get(pUuid);
          }
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
  fallbackKey: number,
  resultsById: Map<string, ParsedEvent>,
): SpanNode | null {
  if (typeof ev.ts !== "number") return null;
  if (ev.kind === "assistant") {
    return {
      span: {
        id: ev.raw.uuid ?? `assistant-${fallbackKey}`,
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
        id: ev.raw.uuid ?? id ?? `tool-${fallbackKey}`,
        parentId: turnId,
        depth: 1,
        label: ev.toolName ?? "tool",
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
