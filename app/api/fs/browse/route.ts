import { browseDirectory, InvalidPathError } from "@/lib/fs-browse";
import type { NextRequest } from "next/server";

import { withMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function _GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get("path") ?? undefined;
  try {
    const listing = await browseDirectory(target ?? undefined);
    return Response.json(listing);
  } catch (err) {
    if (err instanceof InvalidPathError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export const GET = withMetrics("/api/fs/browse", _GET);
