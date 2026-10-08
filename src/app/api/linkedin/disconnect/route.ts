import { disconnect, getStatus } from "@/lib/linkedin.ts";

export const runtime = "nodejs";

export async function POST() {
  await disconnect();
  return Response.json(await getStatus());
}
