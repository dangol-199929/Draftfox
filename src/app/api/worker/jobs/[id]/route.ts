import { getVideoJob, jobDir, nextStage, sameTopicJobs } from "@/lib/video-jobs.ts";
import { workerAuthError } from "@/lib/worker-auth.ts";

export const runtime = "nodejs";

// The job, its next stage and folder, and other videos on the same topic (for the quality check).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = workerAuthError(request);
  if (denied) return denied;
  const { id } = await params;
  const job = getVideoJob(id);
  if (!job) return Response.json({ error: "No such video job." }, { status: 404 });
  const duplicates = sameTopicJobs(id, job.topic).map((other) => ({ id: other.id, status: other.status, createdAt: other.createdAt }));
  return Response.json({ job, stage: nextStage(job.completedStages), dir: jobDir(id), duplicates });
}
