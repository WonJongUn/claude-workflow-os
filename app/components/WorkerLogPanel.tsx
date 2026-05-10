"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ExternalLink, Terminal } from "lucide-react";
import { fetchWorkerLog } from "./ticket-client";
import { RefreshButton } from "./ui";

type WorkerLogPanelProps = {
  /** 대상 티켓 id. 폴링 키. */
  ticketId: string;
  /** 워커가 spawn한 활성 세션 id. 있으면 /sessions/<id> 점프 링크 노출. */
  currentSessionId?: string;
  /** 워커 로그 절대 경로. 없으면 패널 자체를 렌더하지 않는다 — 호출자가 판단. */
  workerLog?: string;
};

/**
 * 편집 모달 상단에 붙는 워커 진행 상황 패널.
 * - 워커 로그 마지막 32KB를 5초 폴링으로 보여준다.
 * - currentSessionId가 있으면 /sessions/<id> 풀 뷰어로 가는 링크를 함께 표시.
 */
export function WorkerLogPanel({
  ticketId,
  currentSessionId,
  workerLog,
}: WorkerLogPanelProps) {
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["worker-log", ticketId],
    queryFn: () => fetchWorkerLog(ticketId),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  if (!workerLog && !currentSessionId) return null;

  return (
    <div className="mb-4 rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">
          <Terminal className="h-3.5 w-3.5" aria-hidden />
          <span>워커 진행 상황</span>
          {data?.truncated && (
            <span className="text-[10px] text-zinc-500">
              (마지막 32KB만 표시)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {currentSessionId && (
            <Link
              href={`/sessions/${currentSessionId}`}
              target="_blank"
              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <ExternalLink className="h-3 w-3" aria-hidden />
              세션 보기
            </Link>
          )}
          <RefreshButton onClick={() => refetch()} isFetching={isFetching} />
        </div>
      </div>
      <pre className="scroll-thin max-h-64 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
        {data?.content || (data?.exists === false ? "(아직 로그 없음 — 워커가 spawn되지 않았거나 로그가 비어 있습니다)" : "로딩 중…")}
      </pre>
      {workerLog && (
        <div className="border-t border-zinc-200 px-3 py-1.5 font-mono text-[10px] text-zinc-500 dark:border-zinc-800">
          {workerLog}
        </div>
      )}
    </div>
  );
}
