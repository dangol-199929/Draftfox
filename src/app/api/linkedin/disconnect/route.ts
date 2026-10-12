import { logEvent } from "@/lib/db.ts";
import { disconnect, getStatus } from "@/lib/linkedin.ts";

export const runtime = "nodejs";

export async function POST() {
  await disconnect();
  logEvent("linkedin_disconnected");
  return Response.json(await getStatus());
}
