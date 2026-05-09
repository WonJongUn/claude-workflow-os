"use client";

import { use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, PlayCircle } from "lucide-react";
import { fetchSessionInfo } from "@/app/components/project-client";
import { SessionDetailView } from "@/app/components/SessionPanel";
import { useResumeSession } from "@/app/components/use-sessions";

/**
 * 세션 상세 페이지. 사이드바에서 직접 라우팅되지 않고 세션 패널의 i 버튼으로 진입.
 * 라우트 세그먼트 `/sessions/[id]`의 id (UUID)로 세션을 조회한다.
 */
export default function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: sessionId } = use(params);
  const search = useSearchParams();
  const highlightTaskId = search.get("taskId") ?? undefined;
  const { data: session, isLoading, error } = useQuery({
    queryKey: ["session-info", sessionId],
    queryFn: () => fetchSessionInfo(sessionId),
    enabled: sessionId.length > 0,
    staleTime: 5_000,
  });
  const { resume, isPending: isResuming } = useResumeSession();

  return (
    <div className="flex w-full flex-col gap-5 py-5 pl-6 pr-16">
      <header className="flex flex-col gap-1.5">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          <span>대시보드로</span>
        </Link>
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            세션 상세
          </h1>
          {session && (
            <span className="font-mono text-[11px] text-zinc-500">
              {session.id}
            </span>
          )}
          {session && (
            <button
              type="button"
              onClick={() => resume(session.id)}
              disabled={isResuming || Boolean(session.runtime)}
              aria-label="세션 이어가기"
              title={
                session.runtime
                  ? "프로세스가 살아있어 새로 띄울 수 없습니다 — 기존 터미널에서 계속하거나 종료 후 시도하세요"
                  : "claude --resume 으로 이 세션을 새 터미널에서 이어갑니다"
              }
              className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 px-2 text-xs text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            >
              <PlayCircle className="h-3.5 w-3.5" aria-hidden />
              <span>
                {session.runtime
                  ? "실행 중"
                  : isResuming
                    ? "실행 중…"
                    : "이어가기"}
              </span>
            </button>
          )}
        </div>
      </header>

      {isLoading && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          로딩 중…
        </div>
      )}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          세션을 찾을 수 없습니다.
        </div>
      )}
      {session && (
        <SessionDetailView
          session={session}
          highlightTaskId={highlightTaskId}
        />
      )}
    </div>
  );
}
