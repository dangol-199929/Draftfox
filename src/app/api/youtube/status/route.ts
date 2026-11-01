import { getStatus } from "@/lib/youtube.ts";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(await getStatus());
}
