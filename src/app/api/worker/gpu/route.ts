import { badRequest } from "@/lib/api.ts";
import { currentGpuLease, freeComfyUi, releaseGpu, tryAcquireGpu, unloadOllamaModels } from "@/lib/gpu-lock.ts";
import { readWorkerBody, workerAuthError } from "@/lib/worker-auth.ts";

export const runtime = "nodejs";

const MAX_WAIT_MS = 25_000;
const POLL_MS = 500;

// The worker's side of the GPU lease (see gpu-lock.ts). Body: { workerId, action, purpose?, uses?, waitSeconds?, ttlSeconds? }
// - acquire: waits up to waitSeconds (at most 25) for the lease; { granted: false } means ask again. App requests
//   go first. With uses: "comfyui", Ollama's models are unloaded once it's granted, to make room.
// - renew: extends the lease during long work. - release: gives it back; with uses: "comfyui", ComfyUI frees its memory.
export async function POST(request: Request) {
  const denied = workerAuthError(request);
  if (denied) return denied;
  const input = await readWorkerBody(request);
  if (!input) return badRequest("Send { workerId, action }.");
  const { body, workerId } = input;
  const holder = `worker:${workerId}`;
  const purpose = typeof body.purpose === "string" && body.purpose.trim() ? body.purpose.trim().slice(0, 100) : "Video worker";
  const ttlMs = Math.min(Math.max(Number(body.ttlSeconds) || 300, 30), 3600) * 1000;
  const usesComfy = body.uses === "comfyui";

  if (body.action === "acquire") {
    const deadline = Date.now() + Math.min(Math.max(Number(body.waitSeconds) || 0, 0) * 1000, MAX_WAIT_MS);
    while (!tryAcquireGpu(holder, purpose, ttlMs, "background")) {
      if (Date.now() >= deadline || request.signal.aborted) {
        return Response.json({ granted: false, lease: currentGpuLease() });
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    const unloaded = usesComfy ? await unloadOllamaModels() : [];
    return Response.json({ granted: true, lease: currentGpuLease(), unloaded });
  }
  if (body.action === "renew") {
    const lease = currentGpuLease();
    if (lease?.holder !== holder) return Response.json({ granted: false, lease });
    tryAcquireGpu(holder, purpose, ttlMs, "background");
    return Response.json({ granted: true, lease: currentGpuLease() });
  }
  if (body.action === "release") {
    releaseGpu(holder);
    if (usesComfy) await freeComfyUi();
    return Response.json({ ok: true });
  }
  return badRequest("action must be acquire, renew or release.");
}
