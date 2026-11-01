import { mkdirSync } from "node:fs";
import { badRequest } from "@/lib/api.ts";
import { claimVideoJob, jobDir, nextStage } from "@/lib/video-jobs.ts";
import { readWorkerBody, workerAuthError } from "@/lib/worker-auth.ts";

export const runtime = "nodejs";

// The worker asks for its next job. Answers { job: null } when there's nothing to do.
export async function POST(request: Request) {
  const denied = workerAuthError(request);
  if (denied) return denied;
  const input = await readWorkerBody(request);
  if (!input) return badRequest("Send { workerId }.");

  const job = claimVideoJob(input.workerId);
  if (!job) return Response.json({ job: null });
  const dir = jobDir(job.id);
  mkdirSync(dir, { recursive: true });
  return Response.json({ job, stage: nextStage(job.completedStages), dir });
}
