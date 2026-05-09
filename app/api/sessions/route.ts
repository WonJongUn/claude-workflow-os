import path from "node:path";
import type { NextRequest } from "next/server";
import { withMetrics } from "@/lib/metrics";
import { ALL_PROJECT, getProject, ProjectNotFoundError } from "@/lib/project-store";
import { listAllSessions, listSessionsForCwd } from "@/lib/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function _GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("project") ?? "ALL";
  try {
    if (projectId === ALL_PROJECT.id) {
      const sessions = await listAllSessions();
      return Response.json({ sessions });
    }
    const project = await getProject(projectId);
    // workDir가 명시되어 있으면 그것을, 아니면 claudeRoot의 부모(또는 자기 자신)를 사용.
    const cwd =
      project.workDir ??
      (project.claudeRoot.endsWith(`${path.sep}.claude`)
        ? path.dirname(project.claudeRoot)
        : project.claudeRoot);
    const sessions = await listSessionsForCwd(cwd);
    return Response.json({ sessions });
  } catch (err) {
    if (err instanceof ProjectNotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export const GET = withMetrics("/api/sessions", _GET);
