import { loadClaudeContext } from "@/lib/claude-fs";
import { getProject, ProjectNotFoundError } from "@/lib/project-store";
import type { NextRequest } from "next/server";

import { withMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function _GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("project");
  try {
    const project = projectId ? await getProject(projectId) : null;
    const ctx = await loadClaudeContext(project?.claudeRoot);
    return Response.json(ctx);
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

export const GET = withMetrics("/api/context", _GET);
