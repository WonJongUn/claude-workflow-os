"use client";

import { ContextPanel } from "../components/ContextPanel";
import { ProjectTabs } from "../components/ProjectTabs";
import { SessionPanel } from "../components/SessionPanel";
import { useProjects } from "../components/use-projects";

export default function DashboardPage() {
  const { projects, activeId, setActive } = useProjects();

  return (
    <div className="flex w-full flex-col gap-6 py-6 pl-8 pr-16 2xl:pl-12 2xl:pr-20">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          대시보드
        </h1>
        <p className="text-xs text-zinc-500">
          현재 세션과 활성 프로젝트의 .claude 정보.
        </p>
      </header>

      <ProjectTabs
        projects={projects}
        activeId={activeId}
        onSelect={setActive}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SessionPanel projectId={activeId} />
        <ContextPanel projectId={activeId} />
      </div>
    </div>
  );
}
