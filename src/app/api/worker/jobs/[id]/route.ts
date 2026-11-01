import { getVideoJob, jobDir, nextStage } from "@/lib/video-jobs.ts";
import { workerAuthError } from "@/lib/worker-auth.ts";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = workerAuthError(request);
  if (denied) return denied;
  const { id } = await params;
  const job = getVideoJob(id);
  if (!job) return Response.json({ error: "No such video job." }, { status: 404 });
  return Response.json({ job, stage: nextStage(job.completedStages), dir: jobDir(id) });
}
