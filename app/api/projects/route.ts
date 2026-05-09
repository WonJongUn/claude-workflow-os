import { ProjectCreateSchema } from "@/lib/schemas";
import { createProject, listProjects } from "@/lib/project-store";

import { withMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function _GET() {
  const projects = await listProjects();
  return Response.json(projects);
}

async function _POST(request: Request) {
  const parsed = ProjectCreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const project = await createProject(parsed.data);
    return Response.json(project, { status: 201 });
  } catch (err) {
    return Response.json({ error: toMessage(err) }, { status: 409 });
  }
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

export const GET = withMetrics("/api/projects", _GET);

export const POST = withMetrics("/api/projects", _POST);
