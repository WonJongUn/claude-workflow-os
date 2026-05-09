import type { ReactNode } from "react";

/** "데이터 없음" 자리표시. 점선 테두리 + 중앙 정렬. children에는 한 줄 안내 문구. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-center rounded-md border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-500">
      {children}
    </div>
  );
}
