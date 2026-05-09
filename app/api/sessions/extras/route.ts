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

/** 세션 상세 화면이 한 번에 받는 보조 데이터 묶음. 메인 + 서브에이전트 jsonl을 합쳐 파싱한 결과. */
export type SessionExtras = {
  /** 편집(Edit/Write/MultiEdit/NotebookEdit) 도구가 만진 파일별 집계. lastAt 내림차순. */
  editedFiles: EditedFile[];
  /** 이 세션이 참조한 `~/.claude/history.jsonl`의 사용자 입력. timestamp 내림차순. */
  userPrompts: UserPrompt[];
  /** 사용자/어시스턴트 대화 턴 (도구 호출 제외, 도구 호출명만 부속). timestamp 내림차순. */
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
