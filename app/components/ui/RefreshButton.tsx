"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "./cn";

type RefreshButtonProps = {
  /** 클릭 시 호출. */
  onClick: () => void;
  /** 갱신 중 여부 (외부 신호). 자동 폴링이든 수동이든 false→true 전이마다 최소 시간 회전 보장. */
  isFetching?: boolean;
  /** 보조 라벨 (툴팁). */
  label?: string;
};

const MIN_SPIN_MS = 600;

/**
 * 카드 헤더용 새로고침 버튼.
 * 사용자 클릭과 백그라운드 폴링 모두에서 최소 회전 시간을 보장해 사용자 인지 가능.
 */
export function RefreshButton({
  onClick,
  isFetching,
  label = "새로고침",
}: RefreshButtonProps) {
  const [spinning, setSpinning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevFetchingRef = useRef<boolean>(false);

  function startSpin() {
    setSpinning(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSpinning(false), MIN_SPIN_MS);
  }

  // 외부 fetch가 시작될 때마다(폴링 포함) 회전 트리거.
  useEffect(() => {
    const prev = prevFetchingRef.current;
    prevFetchingRef.current = isFetching === true;
    if (!prev && isFetching === true) startSpin();
  }, [isFetching]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function handleClick() {
    startSpin();
    onClick();
  }

  const showSpin = spinning || isFetching === true;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      title={label}
      className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      <RefreshCw
        className={cn("h-3.5 w-3.5", showSpin && "animate-spin")}
        aria-hidden
      />
    </button>
  );
}
