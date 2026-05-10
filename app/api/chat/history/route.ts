import { z } from "zod";
import { findSessionPathById } from "@/lib/session-lookup";
import { parseConversation } from "@/lib/session-extras";
import { getChatTurn, isChatActive } from "@/lib/chat-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  /** 조회할 세션 id (UUID). */
  sessionId: z.string().min(1),
});

/** 챗봇 패널 진입 시 과거 대화 복원용. parseConversation을 재사용해 jsonl을 진실 원천으로. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    sessionId: url.searchParams.get("sessionId"),
  });
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid query", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const sessionId = parsed.data.sessionId;
  const active = isChatActive(sessionId);
  const turn = getChatTurn(sessionId);
  const abs = await findSessionPathById(sessionId);
  if (!abs) {
    return Response.json({ messages: [], active, turn });
  }
  const turns = await parseConversation(abs);
  // parseConversation은 시간 역순. 채팅 표시는 시간 오름차순.
  // 메인 흐름만 (서브에이전트 turn은 챗봇 화면에 노이즈).
  const messages = turns
    .filter((t) => !t.sidechain)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((t) => ({
      role: t.role,
      text: t.text,
      timestamp: t.timestamp,
      toolCalls: t.toolCalls ?? [],
    }));
  return Response.json({ messages, active, turn });
}
