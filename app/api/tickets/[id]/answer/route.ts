import path from "node:path";
import { AnswerBodySchema } from "@/lib/schemas";
import { withMetrics } from "@/lib/metrics";
import { getProject } from "@/lib/project-store";
import {
  getTicket,
  transitionTicket,
  updateTicket,
} from "@/lib/ticket-store";
import { spawnHeadlessClaude } from "@/lib/ticket-worker";
import { ticketsDir } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function _POST(
  request: Request,
  ctx: RouteContext<"/api/tickets/[id]/answer">,
) {
  const { id } = await ctx.params;
  const raw = await request.json().catch(() => null);
  const parsed = AnswerBodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const ticket = await getTicket(id);
  if (!ticket) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  if (!ticket.currentSessionId) {
    return Response.json(
      { error: "아직 세션이 시작되지 않았습니다" },
      { status: 409 },
    );
  }
  if (!ticket.projectId) {
    return Response.json(
      { error: "티켓에 projectId가 설정되지 않았습니다" },
      { status: 409 },
    );
  }

  const cwd = await resolveCwd(ticket.projectId);
  if (!cwd) {
    return Response.json(
      { error: "프로젝트 작업 디렉토리를 해석할 수 없습니다" },
      { status: 409 },
    );
  }

  // Server-side state cleanup BEFORE resume — 스킬 누락/지연에도 보드 상태가 정확하게 유지된다.
  // 1) pendingQuestion 클리어
  // 2) REVIEW면 IN_PROGRESS로 전이 (이미 IN_PROGRESS면 noop)
  if (ticket.pendingQuestion) {
    await updateTicket(id, { pendingQuestion: null });
  }
  if (ticket.status === "REVIEW") {
    try {
      await transitionTicket(id, "IN_PROGRESS");
    } catch {
      // 이미 다른 곳에서 전이됐을 수 있음 — 무시.
    }
  }

  spawnHeadlessClaude({
    cwd,
    sessionId: ticket.currentSessionId,
    resume: true,
    prompt: parsed.data.answer,
    ticketId: id,
    logPath:
      ticket.workerLog ?? path.join(ticketsDir(), ".logs", `${id}.log`),
  });

  return Response.json({ ok: true });
}

/**
 * 워처와 동일한 cwd 해석. project-store에서 workDir 우선, 없으면 claudeRoot 보정.
 */
async function resolveCwd(projectId: string): Promise<string | null> {
  try {
    const project = await getProject(projectId);
    if (project.workDir) return project.workDir;
    const root = project.claudeRoot;
    if (root.endsWith(`${path.sep}.claude`)) return path.dirname(root);
    return root;
  } catch {
    return null;
  }
}

export const POST = withMetrics("/api/tickets/:id/answer", _POST);
