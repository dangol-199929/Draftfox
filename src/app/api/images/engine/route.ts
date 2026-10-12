import { imageEngine } from "@/lib/image-engines/index.ts";

export const runtime = "nodejs";

// Which image engine is in use and whether it looks ready, with a fix when it isn't.
export async function GET() {
  const engine = imageEngine();
  return Response.json({ id: engine.id, label: engine.label, ...(await engine.check()) });
}
