import { readWorkerStatus } from "@/lib/video-jobs.ts";

export const runtime = "nodejs";

// The video worker's last heartbeat: whether it's online, what it's working on, its GPU and free disk.
export async function GET() {
  return Response.json({ worker: readWorkerStatus() });
}
