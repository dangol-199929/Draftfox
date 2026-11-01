import { badRequest } from "@/lib/api.ts";
import { failStage, heldJob, isVideoStage } from "@/lib/video-jobs.ts";
import { readWorkerBody, workerAuthError } from "@/lib/worker-auth.ts";

export const runtime = "nodejs";

// { workerId, stage, error, retryable? }: the stage failed. The job is retried later unless it has failed
// three times or retryable is false (say, a quality check found a problem that rerunning won't fix).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = workerAuthError(request);
  if (denied) return denied;
  const input = await readWorkerBody(request);
  if (!input) return badRequest("Send { workerId, stage, error }.");
  const { id } = await params;
  const held = heldJob(id, input.workerId);
  if (!held.ok) return badRequest(held.error, held.status);

  const { stage, error, retryable } = input.body;
  if (!isVideoStage(stage)) return badRequest("Unknown stage.");
  const message = typeof error === "string" && error.trim() ? error.trim() : "Unknown error";
  const job = failStage(held.job, stage, message, retryable !== false);
  return Response.json({ job });
}
