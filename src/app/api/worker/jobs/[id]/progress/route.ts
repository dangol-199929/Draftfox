import { badRequest } from "@/lib/api.ts";
import { heldJob, reportProgress } from "@/lib/video-jobs.ts";
import { readWorkerBody, workerAuthError } from "@/lib/worker-auth.ts";

export const runtime = "nodejs";

// { workerId, progress: 0..1, message?, level?: "info" | "warn" } for the stage the job is in.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = workerAuthError(request);
  if (denied) return denied;
  const input = await readWorkerBody(request);
  if (!input) return badRequest("Send { workerId, progress }.");
  const { id } = await params;
  const held = heldJob(id, input.workerId);
  if (!held.ok) return badRequest(held.error, held.status);

  const progress = typeof input.body.progress === "number" ? input.body.progress : held.job.progress;
  const message = typeof input.body.message === "string" ? input.body.message.slice(0, 500) : undefined;
  reportProgress(id, input.workerId, progress, message, input.body.level === "warn" ? "warn" : "info");
  return Response.json({ ok: true });
}
