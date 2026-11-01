import { currentGpuLease, interactiveWaiting } from "@/lib/gpu-lock.ts";
import { readWorkerStatus } from "@/lib/video-jobs.ts";

export const runtime = "nodejs";

// The video worker's last heartbeat (whether it's online, what it's working on, its GPU and free disk),
// and who has the graphics card right now.
export async function GET() {
  return Response.json({ worker: readWorkerStatus(), gpu: { lease: currentGpuLease(), waiting: interactiveWaiting() } });
}
