import { badRequest } from "@/lib/api.ts";
import { currentGpuLease } from "@/lib/gpu-lock.ts";
import { heldJob } from "@/lib/video-jobs.ts";
import { generateVideoScript } from "@/lib/video-script.ts";
import { normalizeVideoSettings } from "@/lib/video-settings.ts";
import { readWorkerBody, workerAuthError } from "@/lib/worker-auth.ts";

export const runtime = "nodejs";

// { workerId, maxWords? }: writes the job's script with VIDEO_SCRIPT_MODEL. The worker must hold the GPU lease
// (it takes it through /api/worker/gpu first), so this doesn't take it again. maxWords asks for a shorter
// narration, when the spoken one came out too long.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = workerAuthError(request);
  if (denied) return denied;
  const input = await readWorkerBody(request);
  if (!input) return badRequest("Send { workerId }.");
  const { id } = await params;
  const held = heldJob(id, input.workerId);
  if (!held.ok) return badRequest(held.error, held.status);
  if (currentGpuLease()?.holder !== `worker:${input.workerId}`) return badRequest("Take the GPU lease first.", 409);

  const requested = Number(input.body.maxWords);
  const maxWords = Number.isFinite(requested) && requested >= 12 ? requested : undefined;
  // Older videos have no settings; .env's length and speed apply to them.
  const settings = held.job.assets.settings ? normalizeVideoSettings(held.job.assets.settings) : null;
  try {
    const result = await generateVideoScript(held.job.topic, {
      maxWords,
      skipGpuLease: true,
      signal: request.signal,
      seriesId: held.job.seriesId,
      seconds: settings?.seconds,
      voiceSpeed: settings?.voiceSpeed,
      scenes: settings?.scenes,
      tone: settings?.scriptTone,
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502 });
  }
}
