import { badRequest } from "@/lib/api.ts";
import { getVideoJob, renewLease, saveWorkerStatus } from "@/lib/video-jobs.ts";
import { readWorkerBody, workerAuthError } from "@/lib/worker-auth.ts";

export const runtime = "nodejs";

const text = (value: unknown, max = 200) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

// Sent every few seconds: keeps the worker's lease on its current job and shows the worker as online.
// Answers { stop: true } when that job was cancelled or taken away, so the worker drops it.
export async function POST(request: Request) {
  const denied = workerAuthError(request);
  if (denied) return denied;
  const input = await readWorkerBody(request);
  if (!input) return badRequest("Send { workerId }.");
  const { body, workerId } = input;

  const jobId = text(body.jobId, 100);
  saveWorkerStatus({
    workerId,
    lastHeartbeat: new Date().toISOString(),
    jobId,
    stage: text(body.stage, 40),
    gpu: text(body.gpu),
    freeDiskGb: typeof body.freeDiskGb === "number" && Number.isFinite(body.freeDiskGb) ? body.freeDiskGb : null,
    version: text(body.version, 40),
  });

  let stop = false;
  if (jobId) {
    stop = !renewLease(jobId, workerId) || getVideoJob(jobId)?.status === "CANCELLED";
  }
  return Response.json({ ok: true, stop });
}
