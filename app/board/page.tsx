"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Info } from "lucide-react";
import { CreateTicketButton } from "../components/CreateTicketButton";
import { ProjectTabs } from "../components/ProjectTabs";
import {
  TicketBoard,
  type BoardViewMode,
} from "../components/TicketBoard";
import { BoardHelpModal } from "../components/BoardHelpModal";
import { useProjects } from "../components/use-projects";
import { cn } from "../components/ui";

const VIEWS: { id: BoardViewMode; label: string }[] = [
  { id: "project", label: "프로젝트별" },
  { id: "state", label: "진행 상태별" },
  { id: "session", label: "세션별" },
];

function parseView(raw: string | null): BoardViewMode {
  if (raw === "state" || raw === "session") return raw;
  return "project";
}

export default function BoardPage() {
  const { projects, activeId, setActive } = useProjects();
  const [helpOpen, setHelpOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = parseView(searchParams.get("view"));

  function setView(next: BoardViewMode) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "project") params.delete("view");
    else params.set("view", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="flex w-full flex-col gap-6 py-6 pl-8 pr-16 2xl:pl-12 2xl:pr-20">
      <header className="flex items-baseline justify-between gap-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              칸반보드
            </h1>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              aria-label="칸반보드 동작 방식"
              title="칸반보드 동작 방식"
              className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <Info className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            프로젝트 탭과 뷰 옵션으로 그룹핑 기준을 바꿀 수 있습니다.
          </p>
        </div>
        <CreateTicketButton />
      </header>
      <div className="sticky top-0 z-20 -ml-8 -mr-16 border-b border-zinc-200 bg-zinc-50/95 px-8 py-2 backdrop-blur supports-[backdrop-filter]:bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-950/95 dark:supports-[backdrop-filter]:bg-zinc-950/80 2xl:-ml-12 2xl:-mr-20 2xl:px-12">
        <ProjectTabs
          projects={projects}
          activeId={activeId}
          onSelect={setActive}
        />
      </div>
      <div
        role="tablist"
        aria-label="보드 그룹핑"
        className="inline-flex w-fit gap-1 rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800"
      >
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
            className={cn(
              "rounded px-2.5 py-1 text-xs",
              view === v.id
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>
      <TicketBoard activeProjectId={activeId} viewMode={view} />
      <BoardHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
