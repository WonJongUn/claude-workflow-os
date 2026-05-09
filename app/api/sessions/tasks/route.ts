import type { NextRequest } from "next/server";
import { findSessionPathById } from "@/lib/session-lookup";
import {
  readSessionTasks,
  replaySessionTaskTimeline,
  type SessionTask,
  type SessionTaskEvent,
} from "@/lib/session-tasks";

import { withMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 세션 태스크 응답.
 *
 * - `live`: 디스크에 살아있는 태스크 (claude가 진행 중인 동안만 존재).
 * - `history`: jsonl 재생으로 복원한 *전체* 태스크 (라이브 포함, 완료/삭제 포함).
 *
 * 두 source는 독립적이지만 표시 집합은 자연스럽게 겹친다 — live ⊆ history (대체로).
 */
export type SessionTasksResponse = {
  live: SessionTask[];
  history: SessionTask[];
  /**
   * 리플레이용 이벤트 타임라인. `?events=1` 쿼리가 있을 때만 채워진다.
   * 라이브와 이력의 합집합을 시간순 이벤트로 풀어쓴 형태.
   */
  events?: SessionTaskEvent[];
};

/**
 * 세션의 태스크 라이브 + 이력 동시 조회. 세션 id (UUID)로 jsonl 경로를 lookup.
 */
async function _GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }
  // jsonl이 없는 세션도 라이브 태스크는 있을 수 있어 abs 누락은 허용한다.
  const abs = await findSessionPathById(sessionId);

  const wantEvents = request.nextUrl.searchParams.get("events") === "1";
  const [live, replayed] = await Promise.all([
    readSessionTasks(sessionId),
    abs
      ? replaySessionTaskTimeline(abs)
      : Promise.resolve({
          events: [] as SessionTaskEvent[],
          finalTasks: [] as SessionTask[],
        }),
  ]);
  // 라이브에만 있고 이력(replay)에는 없는 태스크는 합쳐 history가 항상 라이브를 포함하게 한다.
  // 같은 id가 있으면 replay 결과가 우선 — replay가 전 히스토리를 누적해 더 정확한 상태를 들고 있음.
  const mergedHistory = mergeLiveIntoHistory(replayed.finalTasks, live);
  const result: SessionTasksResponse = {
    live,
    history: mergedHistory,
  };
  if (wantEvents) result.events = replayed.events;
  return Response.json(result);
}

/** history에 없는 live 태스크만 추가. 순서는 history 순서를 유지하고 새 항목은 뒤에 append. */
function mergeLiveIntoHistory(
  history: SessionTask[],
  live: SessionTask[],
): SessionTask[] {
  if (live.length === 0) return history;
  const seen = new Set(history.map((t) => t.id));
  const out = [...history];
  for (const t of live) {
    if (!seen.has(t.id)) out.push(t);
  }
  return out;
}

export const GET = withMetrics("/api/sessions/tasks", _GET);
