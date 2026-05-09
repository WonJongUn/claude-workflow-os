"use client";

import { useEffect, useMemo } from "react";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import type { SessionTask, SessionTaskEvent } from "./project-client";

/**
 * 한 이벤트당 고정 딜레이(ms). 카드 색 전환(300ms)을 인식할 수 있게 충분히 길게.
 */
export const REPLAY_STEP_MS = 2200;

/**
 * 리플레이의 현재 시점에 보이는 태스크들(스냅샷 누적)과 마지막 이벤트.
 * 부모는 이 결과를 기존 이력 칸반에 그대로 흘려보내 카드가 컬럼 사이를 이동하게 만든다.
 */
export type ReplayState = {
  /** 0..events.length 범위. 0이면 시작 전, length면 끝. */
  step: number;
  /** 자동 재생 중 여부. */
  playing: boolean;
  /** 현재 step까지 적용한 결과 — 컬럼별로 흩어 보여줄 태스크 목록. */
  tasks: SessionTask[];
  /** 직전에 적용된 이벤트(없으면 null). 갓 변한 카드 하이라이트에 쓴다. */
  lastEvent: SessionTaskEvent | null;
  /** 끝에 닿았는지(다시 재생 안내용). */
  isAtEnd: boolean;
};

/**
 * events에서 현재 step만큼 적용한 태스크 스냅샷 목록을 뽑는다.
 * id 기준 monotonic 증가라 정렬 안정.
 */
export function useReplayTasks(
  events: SessionTaskEvent[],
  step: number,
): SessionTask[] {
  return useMemo(() => {
    const map = new Map<string, SessionTask>();
    for (let i = 0; i < step && i < events.length; i++) {
      const ev = events[i];
      map.set(ev.taskId, ev.snapshot);
    }
    return Array.from(map.values()).sort(
      (a, b) => Number(a.id) - Number(b.id),
    );
  }, [events, step]);
}

/**
 * playing이 true이고 끝이 아니면 REPLAY_STEP_MS마다 step++. 끝나면 자동 정지(별도 setState 없이).
 */
export function useReplayAutoplay(
  effectivelyPlaying: boolean,
  step: number,
  advance: () => void,
): void {
  useEffect(() => {
    if (!effectivelyPlaying) return;
    const id = setTimeout(advance, REPLAY_STEP_MS);
    return () => clearTimeout(id);
    // step을 deps에 넣어 매 단계마다 새 timeout 스케줄.
  }, [effectivelyPlaying, step, advance]);
}

type ControlsProps = {
  /** 0..events.length. */
  step: number;
  /** 이벤트 총 개수. */
  total: number;
  /** 자동 재생 토글 상태. */
  playing: boolean;
  /** 끝 도달 여부 — 버튼 라벨이 "다시 재생"으로 바뀜. */
  isAtEnd: boolean;
  /** ▶︎/⏸ 클릭. */
  onTogglePlay: () => void;
  /** ⏮ 클릭(0으로). */
  onReset: () => void;
  /** 슬라이더 변경. */
  onSeek: (next: number) => void;
  /** 리플레이 종료. */
  onExit: () => void;
};

/**
 * 이력 칸반 위에 띄우는 가벼운 컨트롤 바.
 * 칸반 자체는 부모가 그대로 렌더하므로 여긴 재생 상태만 다룬다.
 */
export function SessionTasksReplayControls({
  step,
  total,
  playing,
  isAtEnd,
  onTogglePlay,
  onReset,
  onSeek,
  onExit,
}: ControlsProps) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={playing ? "일시정지" : "재생"}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-zinc-900 px-2 text-xs text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {playing ? (
            <Pause className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Play className="h-3.5 w-3.5" aria-hidden />
          )}
          <span>{isAtEnd ? "다시 재생" : playing ? "일시정지" : "재생"}</span>
        </button>
        <button
          type="button"
          onClick={onReset}
          aria-label="처음으로"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 px-2 text-xs text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          <span>처음으로</span>
        </button>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-zinc-500">
          {step}/{total}
        </span>
        <button
          type="button"
          onClick={onExit}
          aria-label="리플레이 종료"
          title="리플레이 종료"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={total}
        value={step}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="w-full accent-zinc-900 dark:accent-zinc-100"
        aria-label="재생 위치"
      />
    </div>
  );
}
