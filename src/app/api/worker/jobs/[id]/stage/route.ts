import { badRequest } from "@/lib/api.ts";
import {
  completeStage,
  heldJob,
  isVideoStage,
  jobRelativePath,
  nextStage,
  type StageResult,
  type VideoScene,
  type VideoScript,
} from "@/lib/video-jobs.ts";
import { readWorkerBody, workerAuthError } from "@/lib/worker-auth.ts";

export const runtime = "nodejs";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// { workerId, stage, seconds?, result: { script?, scenes?, assets?, outputPath?, qc? } }: the stage finished.
// Answers with the job and the next stage to run (null when the video is ready for review).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = workerAuthError(request);
  if (denied) return denied;
  const input = await readWorkerBody(request);
  if (!input) return badRequest("Send { workerId, stage, result }.");
  const { id } = await params;
  const held = heldJob(id, input.workerId);
  if (!held.ok) return badRequest(held.error, held.status);

  const { stage, result, seconds } = input.body;
  if (!isVideoStage(stage)) return badRequest("Unknown stage.");
  if (stage !== held.job.stage) return badRequest(`The job is at the ${held.job.stage} stage, not ${stage}.`, 409);
  if (result !== undefined && !isObject(result)) return badRequest("result must be an object.");

  const stageResult: StageResult = {};
  if (result) {
    if (isObject(result.script)) stageResult.script = result.script as VideoScript;
    if (Array.isArray(result.scenes)) stageResult.scenes = result.scenes as VideoScene[];
    if (isObject(result.assets)) stageResult.assets = result.assets;
    if (isObject(result.qc)) stageResult.qc = result.qc;
    if (typeof result.outputPath === "string") {
      const path = jobRelativePath(id, result.outputPath);
      if (!path) return badRequest("outputPath must be inside the job's folder.");
      stageResult.outputPath = path;
    }
  }

  const job = completeStage(held.job, stage, stageResult, typeof seconds === "number" ? seconds : undefined);
  return Response.json({ job, stage: job.status === "AWAITING_APPROVAL" ? null : nextStage(job.completedStages) });
}
