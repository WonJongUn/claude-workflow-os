import { z } from "zod";
import { abortChatSession } from "@/lib/chat-abort";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  /** 중단할 세션 id. */
  sessionId: z.string().min(1),
});

/** "중단" 버튼이 호출. 진행 중 spawn에 SIGTERM. 세션 자체는 jsonl 그대로. */
export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const aborted = abortChatSession(parsed.data.sessionId);
  return Response.json({ aborted });
}
