import { badRequest, readJsonObject } from "@/lib/api.ts";
import { writeCardContent } from "@/lib/card.tsx";

export const runtime = "nodejs";

// Body: { text }. Returns { content: { tag, hook, points, illustration } } written from the post.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return badRequest("Write the post first, then make a card from it.");
  try {
    return Response.json({ content: await writeCardContent(text) });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 503 });
  }
}
