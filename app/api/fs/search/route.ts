import { getSearchRoot, searchFiles } from "@/lib/file-search";
import { ProjectNotFoundError } from "@/lib/project-store";
import type { NextRequest } from "next/server";

import { withMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function _GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("project") ?? "ALL";
  const query = request.nextUrl.searchParams.get("q") ?? "";
  try {
    const baseDir = await getSearchRoot(projectId);
    const hits = await searchFiles(baseDir, query);
    return Response.json({ baseDir, hits });
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

export const GET = withMetrics("/api/fs/search", _GET);
