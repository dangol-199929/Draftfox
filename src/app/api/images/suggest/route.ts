import { badRequest, readJsonObject } from "@/lib/api.ts";
import { suggestImagePrompt } from "@/lib/images.ts";

export const runtime = "nodejs";

// Body: { text }. Returns { prompt }: an image idea for the post, written by the text model.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return badRequest("Write the post first, then ask for an image idea.");
  try {
    return Response.json({ prompt: await suggestImagePrompt(text) });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 503 });
  }
}
