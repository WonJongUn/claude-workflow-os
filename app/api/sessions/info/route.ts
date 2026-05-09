import type { NextRequest } from "next/server";
import { findSessionPathById } from "@/lib/session-lookup";
import { readSessionInfo } from "@/lib/sessions";

import { withMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 단일 세션 정보 조회. 세션 id (UUID)로 매칭.
 * 페이지(/sessions/[id])가 직접 호출 — 부모 화면이 없을 때를 위한 진입점.
 */
async function _GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }
  const abs = await findSessionPathById(sessionId);
  if (!abs) return Response.json({ error: "not found" }, { status: 404 });
  const info = await readSessionInfo(abs);
  if (!info) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(info);
}

export const GET = withMetrics("/api/sessions/info", _GET);
