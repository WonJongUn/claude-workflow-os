import { z } from "zod";
import { ALL_PROJECT, getProject } from "@/lib/project-store";
import { resolveChatCwd, spawnChatTurn } from "@/lib/chat-spawn";
import {
  appendChatText,
  appendChatTool,
  endChatTurn,
  startChatTurn,
} from "@/lib/chat-bus";
import { registerChatAbort, unregisterChatAbort } from "@/lib/chat-abort";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  /** 보낼 사용자 메시지. 빈 문자열 금지. */
  message: z.string().min(1),
  /** 이어갈 세션 id. 없거나 모르면 새 세션이 시작된다. */
  sessionId: z.string().min(1).optional(),
  /** cwd로 사용할 프로젝트 id. ALL은 거부. */
  projectId: z.string().min(1),
});

/**
 * 챗봇 한 turn을 *시작*하기만 한다. 응답은 첫 sessionId가 확보되는 순간 `{sessionId}`로
 * 즉시 return. 토큰 스트림은 chat-bus에 emit되어 `/api/chat/sse?sessionId=...`로
 * 구독한 모든 탭이 동일하게 받는다 — 보낸 탭/다른 탭 구분 없음.
 *
 * spawn은 detached로 백그라운드에서 끝까지 실행된다 (응답 종료가 spawn을 죽이지 않음).
 * 중단은 `/api/chat/abort`.
 */
export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { message, sessionId, projectId } = parsed.data;
  if (projectId === ALL_PROJECT.id) {
    return Response.json(
      { error: "프로젝트를 선택해주세요. (전체 모드 불가)" },
      { status: 400 },
    );
  }

  let cwd: string;
  try {
    const project = await getProject(projectId);
    cwd = resolveChatCwd(project.workDir, project.claudeRoot);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "project error" },
      { status: 404 },
    );
  }

  // 첫 sessionId 도착까지 기다리는 promise. 이후 spawn은 백그라운드.
  let resolveSid!: (sid: string) => void;
  let rejectSid!: (err: Error) => void;
  const sidPromise = new Promise<string>((resolve, reject) => {
    resolveSid = resolve;
    rejectSid = reject;
  });

  const ctrl = new AbortController();

  // 백그라운드 작업 — 응답 종료와 무관하게 계속 동작.
  void (async () => {
    let activeSid: string | null = sessionId ?? null;
    if (activeSid) {
      registerChatAbort(activeSid, ctrl);
      startChatTurn(activeSid, message);
      resolveSid(activeSid);
    }
    try {
      for await (const ev of spawnChatTurn(
        { cwd, prompt: message, resumeSessionId: sessionId },
        ctrl.signal,
      )) {
        if (ev.type === "system" && "session_id" in ev && ev.session_id) {
          const sid = ev.session_id as string;
          if (!activeSid) {
            activeSid = sid;
            registerChatAbort(sid, ctrl);
            startChatTurn(sid, message);
            resolveSid(sid);
          }
          continue;
        }
        if (!activeSid) continue;
        if (ev.type === "assistant" && "message" in ev) {
          const blocks = (ev as { message: { content: unknown[] } }).message
            .content;
          for (const block of blocks) {
            if (!block || typeof block !== "object") continue;
            const b = block as { type: string; [k: string]: unknown };
            if (b.type === "text" && typeof b.text === "string") {
              appendChatText(activeSid, b.text);
            } else if (b.type === "tool_use") {
              appendChatTool(
                activeSid,
                typeof b.name === "string" ? b.name : "tool",
                summarizeToolInput(b.input),
              );
            }
          }
        }
        // result/error는 generator 종료 트리거이므로 추가 emit은 finally의 endChatTurn으로 통합.
      }
    } catch (err) {
      // 첫 sessionId도 못 받은 채 실패 → 클라에 에러 응답.
      if (!activeSid) {
        rejectSid(err instanceof Error ? err : new Error("spawn failed"));
      }
    } finally {
      if (activeSid) {
        endChatTurn(activeSid);
        unregisterChatAbort(activeSid);
      }
    }
  })();

  try {
    const sid = await sidPromise;
    return Response.json({ sessionId: sid });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "spawn failed" },
      { status: 500 },
    );
  }
}

/** 도구 input을 한 줄로 요약. 너무 길면 자른다. */
function summarizeToolInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return clip(input, 80);
  if (typeof input !== "object") return String(input);
  const o = input as Record<string, unknown>;
  for (const key of ["command", "file_path", "path", "query", "pattern", "url"]) {
    const v = o[key];
    if (typeof v === "string") return clip(v, 80);
  }
  try {
    return clip(JSON.stringify(o), 80);
  } catch {
    return "";
  }
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
