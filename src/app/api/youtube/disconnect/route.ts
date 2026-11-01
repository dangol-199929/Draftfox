import { logEvent } from "@/lib/db.ts";
import { disconnect, getStatus } from "@/lib/youtube.ts";

export const runtime = "nodejs";

export async function POST() {
  await disconnect();
  logEvent("youtube_disconnected");
  return Response.json(await getStatus());
}
