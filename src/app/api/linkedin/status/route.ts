import { getStatus } from "@/lib/linkedin.ts";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(await getStatus());
}
