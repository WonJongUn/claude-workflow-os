import type { NextRequest } from "next/server";
import { findSessionPathById } from "@/lib/session-lookup";
import {
  parseConversation,
  parseEditedFiles,
  readUserPromptsForSession,
  type ConversationTurn,
  type EditedFile,
  type UserPrompt,
} from "@/lib/session-extras";

import { withMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 응답 형태. */
export type SessionExtras = {
  editedFiles: EditedFile[];
  userPrompts: UserPrompt[];
  conversation: ConversationTurn[];
};

/**
 * 세션 보조 정보(편집 파일·사용자 프롬프트·대화 턴)를 한 번에 반환.
 * 세션 id (UUID)로 jsonl 경로를 lookup.
 */
async function _GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }
  const abs = await findSessionPathById(sessionId);
  if (!abs) return Response.json({ error: "not found" }, { status: 404 });
  const [editedFiles, userPrompts, conversation] = await Promise.all([
    parseEditedFiles(abs),
    readUserPromptsForSession(sessionId),
    parseConversation(abs),
  ]);
  const result: SessionExtras = { editedFiles, userPrompts, conversation };
  return Response.json(result);
}

export const GET = withMetrics("/api/sessions/extras", _GET);
