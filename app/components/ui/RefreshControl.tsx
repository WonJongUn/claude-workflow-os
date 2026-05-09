"use client";

import { LastUpdated } from "./LastUpdated";
import { RefreshButton } from "./RefreshButton";

type RefreshControlProps = {
  /** 클릭 시 갱신. */
  onClick: () => void;
  /** 갱신 진행 중 여부. */
  isFetching?: boolean;
  /** 마지막 성공 갱신 시각 (epoch ms). */
  timestamp: number;
};

/**
 * 새로고침 아이콘 위, 그 아래에 갱신 시각을 한 줄 더 두는 작은 스택.
 * 인라인 흐름이라 카드 본문을 침범하지 않으며, 아이콘 회전과 텍스트가 분리되어 있어 흔들림도 없다.
 */
export function RefreshControl({
  onClick,
  isFetching,
  timestamp,
}: RefreshControlProps) {
  return (
    <div className="flex w-20 shrink-0 flex-col items-end gap-0.5 leading-tight tabular-nums">
      <RefreshButton onClick={onClick} isFetching={isFetching} />
      <LastUpdated timestamp={timestamp} />
    </div>
  );
}
