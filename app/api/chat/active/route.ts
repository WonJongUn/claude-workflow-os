import { listActiveChat } from "@/lib/chat-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 현재 spawn 중인 챗봇 세션 id 목록. 리스트 인디케이터 폴링이 사용. */
export async function GET() {
  return Response.json({ sessionIds: listActiveChat() });
}
