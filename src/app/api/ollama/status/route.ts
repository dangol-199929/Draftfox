import { getOllamaStatus } from "@/lib/ollama-status.ts";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(await getOllamaStatus());
}
