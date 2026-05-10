"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSessionTasks } from "./project-client";
import type { SessionTask, SessionTaskEvent } from "@/lib/session-tasks";
import { cn, Tooltip } from "./ui";

/**
 * 세션 TodoWrite/TaskCreate/TaskUpdate 변천을 DAG로 시각화.
 *
 * 모델:
 * - 각 task = 하나의 swim lane (가로축).
 * - create / update 이벤트가 lane 위 노드(시간 축 x).
 * - 노드 색은 그 시점의 status (pending/in_progress/completed/deleted).
 * - 노드 클릭 시 우측 드로어에 그 시점 스냅샷.
 *
 * 위상 정렬은 단일 timeline ts 오름차순으로 자명 (events는 이미 그렇게 정렬).
 * 같은 lane 내 인접 이벤트는 한 줄(가로선)로 연결, 그 위에 노드를 점으로 찍어
 * 시간 흐름과 상태 변화를 동시에 보여준다.
 */
export default function SessionTaskGraphView({
  sessionId,
}: {
  sessionId: string;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["session-tasks-events", sessionId],
    queryFn: () => fetchSessionTasks(sessionId, true),
    // 다른 세션 뷰들과 같은 5초 폴링. 서버 측 replay-task-timeline 캐시가 fingerprint 기반이라 변경 없으면 즉시 반환.
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const events = useMemo(() => data?.events ?? [], [data?.events]);
  const layout = useMemo(() => buildLayout(events), [events]);
  const [selected, setSelected] = useState<NodeRef | null>(null);

  if (isLoading) {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        로딩 중…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        태스크 이벤트를 불러오지 못했습니다.
      </div>
    );
  }
  if (!layout || layout.lanes.length === 0) {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        그래프로 묶을 태스크 이벤트가 없습니다.
      </div>
    );
  }

  const open = selected !== null;
  const range = Math.max(1, layout.maxMs - layout.minMs);
  return (
    <div className="flex flex-col gap-3">
      <Header layout={layout} />
      <div className="flex items-stretch gap-3">
        <div className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <TimeAxis minMs={layout.minMs} range={range} />
          <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {layout.lanes.map((lane) => (
              <Lane
                key={lane.taskId}
                lane={lane}
                minMs={layout.minMs}
                range={range}
                selectedKey={selectedKey(selected)}
                onSelect={(node) => setSelected(node)}
              />
            ))}
          </div>
        </div>
        <div
          className="shrink-0 overflow-hidden transition-[width] duration-300 ease-out"
          style={{ width: open ? DRAWER_WIDTH : "0px" }}
          aria-hidden={!open}
        >
          <div className="h-full" style={{ width: DRAWER_WIDTH }}>
            {selected && (
              <NodeDetail
                node={selected}
                onClose={() => setSelected(null)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const DRAWER_WIDTH = "clamp(28rem, 38vw, 44rem)";
const LANE_LABEL = "w-56";
const TICKS = 8;

/** 한 노드를 식별하는 좌표 (taskId, event index). 외부에서 클릭 식별에 사용. */
type NodeRef = {
  /** 어느 task lane인지. */
  taskId: string;
  /** 그 lane 안 events 배열에서의 인덱스. */
  idx: number;
  /** 편의를 위한 backref — 상세 패널이 바로 사용. */
  event: SessionTaskEvent;
  /** 태스크 라벨(상세 헤더용). */
  taskLabel: string;
};

function selectedKey(n: NodeRef | null): string | null {
  return n ? `${n.taskId}:${n.idx}` : null;
}

type Lane = {
  taskId: string;
  /** 이 lane에 띄울 라벨 (subject 우선, 없으면 id). */
  label: string;
  /** 시간순 events. */
  events: SessionTaskEvent[];
};

type Layout = {
  minMs: number;
  maxMs: number;
  lanes: Lane[];
};

function buildLayout(events: SessionTaskEvent[]): Layout | null {
  if (events.length === 0) return null;
  // ts=0(타임스탬프 누락)인 이벤트는 그래프 좌표를 만들 수 없어 제외.
  const timed = events.filter((e) => e.ts > 0);
  if (timed.length === 0) return null;

  const minMs = timed[0].ts;
  const maxMs = timed[timed.length - 1].ts;

  // taskId → ordered events
  const byTask = new Map<string, SessionTaskEvent[]>();
  for (const ev of timed) {
    let arr = byTask.get(ev.taskId);
    if (!arr) {
      arr = [];
      byTask.set(ev.taskId, arr);
    }
    arr.push(ev);
  }

  // 각 lane의 정렬 기준: 첫 등장 시각 (위에서 아래로 시간순).
  const lanes: Lane[] = [];
  for (const [taskId, evs] of byTask) {
    const last = evs[evs.length - 1].snapshot;
    lanes.push({
      taskId,
      label: laneLabel(taskId, last),
      events: evs,
    });
  }
  // 같은 슬롯의 재할당(예: 1, 1.2, 1.3)이 그래프에서 인접하게 보이도록 (slot, reuse) 사전식 정렬.
  // 슬롯 자체의 등장 순서는 그 슬롯의 *대표(첫)* lane 첫 이벤트 ts 로 결정 — 시간순 직관 유지.
  const slotFirstTs = new Map<number, number>();
  for (const lane of lanes) {
    const slot = parseSlot(lane.taskId).slot;
    const t = lane.events[0].ts;
    const cur = slotFirstTs.get(slot);
    if (cur === undefined || t < cur) slotFirstTs.set(slot, t);
  }
  lanes.sort((a, b) => {
    const A = parseSlot(a.taskId);
    const B = parseSlot(b.taskId);
    const tA = slotFirstTs.get(A.slot) ?? a.events[0].ts;
    const tB = slotFirstTs.get(B.slot) ?? b.events[0].ts;
    if (tA !== tB) return tA - tB;
    if (A.slot !== B.slot) return A.slot - B.slot;
    return A.reuse - B.reuse;
  });
  return { minMs, maxMs, lanes };
}

/**
 * TodoWrite 합성 id 를 (slot, reuse) 로 분해. "1" → (1,1), "1.2" → (1,2).
 * 슬롯/재할당 형식이 아니면(=TaskCreate 의 harness 전역 id) reuse=1 로 취급해 분리되지 않게 한다.
 */
function parseSlot(taskId: string): { slot: number; reuse: number } {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(taskId);
  if (!m) return { slot: Number.MAX_SAFE_INTEGER, reuse: 1 };
  return { slot: Number(m[1]), reuse: m[2] ? Number(m[2]) : 1 };
}

function laneLabel(taskId: string, snap: SessionTask): string {
  const subject = snap.subject?.trim();
  if (subject) return `#${taskId} ${subject}`;
  return `#${taskId}`;
}

function Header({ layout }: { layout: Layout }) {
  const range = layout.maxMs - layout.minMs;
  const totalEvents = layout.lanes.reduce((m, l) => m + l.events.length, 0);
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-xs">
        <Stat label="lane" value={String(layout.lanes.length)} />
        <Stat label="event" value={String(totalEvents)} />
        <Stat
          label="기간"
          value={range > 0 ? formatDurationShort(range) : "—"}
        />
        <Stat
          label="시작"
          value={new Date(layout.minMs).toLocaleString()}
        />
      </div>
      <Legend />
    </div>
  );
}

/**
 * 그래프 아이콘 의미 안내. 색은 그 시점 status, 모양은 이벤트 종류(생성/변경) 구분.
 */
function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-600 dark:text-zinc-400">
      <span className="text-zinc-500">상태</span>
      <LegendDot
        kind="update"
        statusClass={STATUS_COLOR.pending}
        label="대기"
        title="pending — 아직 시작되지 않은 태스크."
      />
      <LegendDot
        kind="update"
        statusClass={STATUS_COLOR.in_progress}
        label="진행"
        title="in_progress — 현재 작업 중."
      />
      <LegendDot
        kind="update"
        statusClass={STATUS_COLOR.completed}
        label="완료"
        title="completed — 작업이 완료됨."
      />
      <LegendDot
        kind="update"
        statusClass={STATUS_COLOR.deleted}
        label="삭제"
        title="deleted — 취소·삭제된 태스크."
      />
      <span className="ml-2 text-zinc-300 dark:text-zinc-700">·</span>
      <span className="text-zinc-500">종류</span>
      <LegendDot
        kind="create"
        statusClass={STATUS_COLOR.pending}
        label="생성"
        title="태스크가 처음 등장한 시점(TaskCreate 또는 TodoWrite로 새 todo가 생긴 순간). 흰 테두리 링."
      />
      <LegendDot
        kind="update"
        statusClass={STATUS_COLOR.pending}
        label="변경"
        title="기존 태스크의 status·필드 변경(TaskUpdate 또는 TodoWrite로 같은 todo가 갱신된 순간)."
      />
    </div>
  );
}

function LegendDot({
  kind,
  statusClass,
  label,
  title,
}: {
  /** 노드 모양 — create면 흰 테두리 링, update면 솔리드. */
  kind: "create" | "update";
  /** 노드 fill 색 (STATUS_COLOR 매핑 그대로). */
  statusClass: string;
  label: string;
  title: string;
}) {
  return (
    <Tooltip content={title}>
      <span className="inline-flex items-center gap-1">
        <span
          className={cn(
            "inline-block rounded-full",
            kind === "create"
              ? "h-3 w-3 border-2 border-white dark:border-zinc-950 ring-1 ring-zinc-400/60"
              : "h-2.5 w-2.5",
            statusClass,
          )}
          aria-hidden
        />
        <span>{label}</span>
      </span>
    </Tooltip>
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

function TimeAxis({ minMs, range }: { minMs: number; range: number }) {
  const ticks = Array.from({ length: TICKS + 1 }, (_, i) => i);
  return (
    <div className="flex border-b border-zinc-200 bg-zinc-50 text-[10px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
      <div className={cn(LANE_LABEL, "shrink-0 px-3 py-1.5")}>task</div>
      <div className="relative flex-1 px-2 py-1.5">
        {ticks.map((i) => {
          const pct = (i / TICKS) * 100;
          const ms = (range * i) / TICKS;
          const positional: React.CSSProperties =
            i === 0
              ? { left: "0.5rem" }
              : i === TICKS
                ? { right: "0.5rem" }
                : { left: `${pct}%`, transform: "translateX(-50%)" };
          return (
            <Tooltip
              key={i}
              content={new Date(minMs + ms).toLocaleString()}
              className="absolute top-1.5 whitespace-nowrap font-mono tabular-nums"
              style={positional}
            >
              <span>{formatTickMs(ms)}</span>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

function formatTickMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  // floor로 표시해 균등 분할(예: range=41분, 8 tick)에서도 0,5,10,15,20,25,30,35,41처럼 균일 간격이 유지된다.
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  return `${Math.floor(ms / 3_600_000)}h`;
}

function formatDurationShort(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}초`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분`;
  const hr = Math.floor(min / 60);
  const restMin = min % 60;
  return restMin === 0 ? `${hr}시간` : `${hr}시간 ${restMin}분`;
}

const STATUS_COLOR: Record<SessionTask["status"], string> = {
  pending: "bg-zinc-300 dark:bg-zinc-600",
  in_progress: "bg-amber-400 dark:bg-amber-500",
  completed: "bg-emerald-500 dark:bg-emerald-500",
  deleted: "bg-red-400 dark:bg-red-500",
};

const STATUS_RING: Record<SessionTask["status"], string> = {
  pending: "ring-zinc-400/50 dark:ring-zinc-500/60",
  in_progress: "ring-amber-400/60 dark:ring-amber-400/60",
  completed: "ring-emerald-400/60 dark:ring-emerald-400/60",
  deleted: "ring-red-400/60 dark:ring-red-400/60",
};

function Lane({
  lane,
  minMs,
  range,
  selectedKey,
  onSelect,
}: {
  lane: Lane;
  minMs: number;
  range: number;
  selectedKey: string | null;
  onSelect: (node: NodeRef) => void;
}) {
  return (
    <div className="flex items-center">
      <div
        className={cn(
          LANE_LABEL,
          "shrink-0 truncate px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-300",
          // reuse>1 lane 은 같은 슬롯의 파생 task — 부모 lane 아래로 시각적으로 들여쓰기.
          parseSlot(lane.taskId).reuse > 1 && "pl-6",
        )}
        title={lane.label}
      >
        {parseSlot(lane.taskId).reuse > 1 && (
          <span
            className="mr-1 text-zinc-400"
            aria-label="같은 슬롯의 재할당"
          >
            ↳
          </span>
        )}
        <span className="font-mono text-zinc-400">#{lane.taskId}</span>{" "}
        <span className="text-zinc-800 dark:text-zinc-200">
          {lane.label.replace(/^#\S+\s*/, "")}
        </span>
      </div>
      <div className="relative flex-1 px-2 py-3">
        <div className="relative h-4">
          {/* lane 가로선: 인접 노드를 잇는 시각적 가이드. */}
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-zinc-200 dark:bg-zinc-800" />
          {lane.events.map((ev, i) => {
            const pct = ((ev.ts - minMs) / range) * 100;
            const key = `${lane.taskId}:${i}`;
            const isSelected = selectedKey === key;
            const status = ev.snapshot.status;
            return (
              <Tooltip
                key={i}
                content={`${ev.kind === "create" ? "생성" : "변경"} · ${status} · ${new Date(ev.ts).toLocaleString()}`}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${pct}%` }}
              >
                <button
                  type="button"
                  onClick={() =>
                    onSelect({
                      taskId: lane.taskId,
                      idx: i,
                      event: ev,
                      taskLabel: lane.label,
                    })
                  }
                  aria-label={`${lane.label} ${ev.kind} ${status}`}
                  className={cn(
                    "rounded-full transition-all",
                    isSelected ? "ring-2" : "ring-1 hover:ring-2",
                    STATUS_RING[status],
                  )}
                >
                  <span
                    className={cn(
                      "block rounded-full",
                      ev.kind === "create"
                        ? "h-3 w-3 border-2 border-white dark:border-zinc-950"
                        : "h-2.5 w-2.5",
                      STATUS_COLOR[status],
                    )}
                  />
                </button>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function NodeDetail({
  node,
  onClose,
}: {
  node: NodeRef;
  onClose: () => void;
}) {
  const ev = node.event;
  const snap = ev.snapshot;
  return (
    <div className="flex h-full flex-col rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px]">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-medium uppercase tracking-wider",
                ev.kind === "create"
                  ? "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
                  : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
              )}
            >
              {ev.kind === "create" ? "생성" : "변경"}
            </span>
            <span className="font-mono text-zinc-600 dark:text-zinc-400">
              #{node.taskId}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-medium",
                statusBadgeClass(snap.status),
              )}
            >
              {snap.status}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-zinc-500">
            {new Date(ev.ts).toLocaleString()}
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
        <Field label="제목">
          <span>{snap.subject || "(없음)"}</span>
        </Field>
        {snap.activeForm && (
          <Field label="활성 폼">
            <span>{snap.activeForm}</span>
          </Field>
        )}
        {snap.description && (
          <Field label="설명">
            <p className="whitespace-pre-wrap leading-relaxed">
              {snap.description}
            </p>
          </Field>
        )}
        {snap.owner && (
          <Field label="담당">
            <span className="font-mono">{snap.owner}</span>
          </Field>
        )}
        {snap.blockedBy && snap.blockedBy.length > 0 && (
          <Field label="blocked by">
            <span className="font-mono">
              {snap.blockedBy.map((id) => `#${id}`).join(", ")}
            </span>
          </Field>
        )}
        {snap.blocks && snap.blocks.length > 0 && (
          <Field label="blocks">
            <span className="font-mono">
              {snap.blocks.map((id) => `#${id}`).join(", ")}
            </span>
          </Field>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <div>{children}</div>
    </div>
  );
}

function statusBadgeClass(status: SessionTask["status"]): string {
  if (status === "in_progress") {
    return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
  }
  if (status === "completed") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
  }
  if (status === "deleted") {
    return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
  }
  return "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
}
