import {
  ProjectNotFoundError,
  ProtectedProjectError,
  deleteProject,
  updateProject,
} from "@/lib/project-store";
import { ProjectUpdateSchema } from "@/lib/schemas";

import { withMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function _PATCH(
  request: Request,
  ctx: RouteContext<"/api/projects/[id]">,
) {
  const { id } = await ctx.params;
  const parsed = ProjectUpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const project = await updateProject(id, parsed.data);
    return Response.json(project);
  } catch (err) {
    return Response.json(
      { error: toMessage(err) },
      { status: errorStatus(err) },
    );
  }
}

async function _DELETE(
  _request: Request,
  ctx: RouteContext<"/api/projects/[id]">,
) {
  const { id } = await ctx.params;
  try {
    await deleteProject(id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return Response.json(
      { error: toMessage(err) },
      { status: errorStatus(err) },
    );
  }
}

function errorStatus(err: unknown): number {
  if (err instanceof ProjectNotFoundError) return 404;
  if (err instanceof ProtectedProjectError) return 403;
  return 400;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

export const PATCH = withMetrics("/api/projects/:id", _PATCH);

export const DELETE = withMetrics("/api/projects/:id", _DELETE);
