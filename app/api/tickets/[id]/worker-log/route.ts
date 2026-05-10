import fs from "node:fs/promises";
import path from "node:path";
import { getTicket } from "@/lib/ticket-store";
import { ticketsDir } from "@/lib/paths";
import { withMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 워커 로그 응답 한계. 끝쪽 N바이트만 읽어 큰 파일에서도 빠르게 응답. */
const MAX_TAIL_BYTES = 32 * 1024;

async function _GET(
  _req: Request,
  ctx: RouteContext<"/api/tickets/[id]/worker-log">,
) {
  const { id } = await ctx.params;
  const ticket = await getTicket(id);
  if (!ticket) {
    return Response.json({ error: "ticket not found" }, { status: 404 });
  }
  if (!ticket.workerLog) {
    return Response.json({ content: "", exists: false, truncated: false });
  }

  // 보안 — 티켓 디렉토리 안의 파일만 읽도록 제한.
  const abs = path.resolve(ticket.workerLog);
  const base = ticketsDir();
  if (!abs.startsWith(`${base}${path.sep}`)) {
    return Response.json({ error: "path not allowed" }, { status: 403 });
  }

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(abs);
  } catch {
    return Response.json({ content: "", exists: false, truncated: false });
  }

  const size = stat.size;
  const start = size > MAX_TAIL_BYTES ? size - MAX_TAIL_BYTES : 0;
  const handle = await fs.open(abs, "r");
  try {
    const length = size - start;
    const buf = Buffer.alloc(length);
    await handle.read(buf, 0, length, start);
    let text = buf.toString("utf8");
    // 잘린 첫 줄은 noise — 두 번째 줄부터 보여 깔끔.
    if (start > 0) {
      const nl = text.indexOf("\n");
      if (nl >= 0) text = text.slice(nl + 1);
    }
    return Response.json({
      content: text,
      exists: true,
      truncated: start > 0,
      size,
      mtimeMs: stat.mtimeMs,
    });
  } finally {
    await handle.close();
  }
}

export const GET = withMetrics("/api/tickets/:id/worker-log", _GET);
