#!/usr/bin/env node
/**
 * Claude Code Stop hook.
 * 워크플로우 OS가 spawn한 자식 세션이 종료(턴 종료)될 때 호출되어,
 * 티켓이 여전히 IN_PROGRESS면 pendingApproval=true + REVIEW로 회수한다.
 * 스킬이 명시적으로 PATCH transition:REVIEW를 했다면 noop.
 *
 * 환경변수:
 *   TICKET_ID                — 대상 티켓 id (워커가 spawn 시 주입)
 *   CLAUDE_WORKFLOW_OS_URL   — 워크플로우 OS base URL (예: http://localhost:3000)
 *
 * 어떤 실패도 silent: process.exit(0). Claude Code 흐름에 영향 주지 않는다.
 */

const ticketId = process.env.TICKET_ID;
const baseUrl = process.env.CLAUDE_WORKFLOW_OS_URL;

if (!ticketId || !baseUrl) {
  process.exit(0);
}

try {
  const res = await fetch(`${baseUrl}/api/tickets/${ticketId}`);
  if (!res.ok) process.exit(0);
  const ticket = await res.json();
  if (ticket?.status !== "IN_PROGRESS") process.exit(0);

  await fetch(`${baseUrl}/api/tickets/${ticketId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pendingApproval: true }),
  });
  await fetch(`${baseUrl}/api/tickets/${ticketId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transition: "REVIEW" }),
  });
} catch (err) {
  console.error(`[ticket-stop-hook] ${err?.message ?? err}`);
}
process.exit(0);
