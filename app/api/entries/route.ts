import {
  EntryNotFoundError,
  InvalidEntryNameError,
  deleteEntry,
  saveEntry,
} from "@/lib/entry-store";
import { ProjectNotFoundError } from "@/lib/project-store";
import { EntryDeleteSchema, EntrySaveSchema } from "@/lib/schemas";

import { withMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function _POST(request: Request) {
  const parsed = EntrySaveSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    await saveEntry(parsed.data);
    return new Response(null, { status: 204 });
  } catch (err) {
    return Response.json(
      { error: toMessage(err) },
      { status: errorStatus(err) },
    );
  }
}

async function _DELETE(request: Request) {
  const parsed = EntryDeleteSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    await deleteEntry(parsed.data);
    return new Response(null, { status: 204 });
  } catch (err) {
    return Response.json(
      { error: toMessage(err) },
      { status: errorStatus(err) },
    );
  }
}

function errorStatus(err: unknown): number {
  if (err instanceof EntryNotFoundError) return 404;
  if (err instanceof ProjectNotFoundError) return 404;
  if (err instanceof InvalidEntryNameError) return 400;
  return 500;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

export const POST = withMetrics("/api/entries", _POST);

export const DELETE = withMetrics("/api/entries", _DELETE);
