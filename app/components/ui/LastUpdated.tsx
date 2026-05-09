"use client";

import { useEffect, useState } from "react";

type LastUpdatedProps = {
  /** 마지막 갱신 시각 (epoch ms). 0/undefined면 "대기 중" 표시. */
  timestamp: number;
};

/**
 * 새로고침 버튼 바로 아래 등 작은 보조 라인으로 쓰는 갱신 시각.
 * 5초마다 self-tick 해서 "N초 전" 표시가 멈춰 보이지 않도록 한다.
 */
export function LastUpdated({ timestamp }: LastUpdatedProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="font-mono text-[10px] text-zinc-500 dark:text-zinc-500">
      {timestamp > 0 ? formatRelative(timestamp) : "대기 중"}
    </span>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 5_000) return "방금";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}초 전`;
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return new Date(ts).toLocaleString();
}
