import type { ReactNode } from "react";
import { Badge } from "./Badge";

/** 보드 컬럼 표면. 제목 + 카운트 뱃지 + 자식 카드들 세로 스택. */
export function Column({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
          {title}
        </h3>
        <Badge variant="default">{count}</Badge>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}
