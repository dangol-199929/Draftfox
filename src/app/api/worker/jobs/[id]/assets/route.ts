import { badRequest } from "@/lib/api.ts";
import { heldJob, jobRelativePath, logVideoEvent, updateVideoJob } from "@/lib/video-jobs.ts";
import { readWorkerBody, workerAuthError } from "@/lib/worker-auth.ts";

export const runtime = "nodejs";

// { workerId, name, path }: records a file the worker wrote into the job's folder (data/videos/<id>/) under a name,
// such as "narration" or "scene-1", before the stage finishes, so a restart can reuse it.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = workerAuthError(request);
  if (denied) return denied;
  const input = await readWorkerBody(request);
  if (!input) return badRequest("Send { workerId, name, path }.");
  const { id } = await params;
  const held = heldJob(id, input.workerId);
  if (!held.ok) return badRequest(held.error, held.status);

  const { name, path } = input.body;
  if (typeof name !== "string" || !/^[\w.-]{1,60}$/.test(name)) return badRequest("name must be a short word.");
  const relativePath = typeof path === "string" ? jobRelativePath(id, path) : null;
  if (!relativePath) return badRequest("path must be a file inside the job's folder.");

  const files = { ...(held.job.assets.files as Record<string, string> | undefined), [name]: relativePath };
  updateVideoJob(id, { assets: { ...held.job.assets, files } });
  logVideoEvent(id, held.job.stage, "info", `Saved ${name}: ${relativePath}`);
  return Response.json({ ok: true, path: relativePath });
}
