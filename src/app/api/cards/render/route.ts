import { badRequest, readJsonObject } from "@/lib/api.ts";
import { LAYOUTS, PALETTES, cleanContent, renderCard, type Layout, type Palette } from "@/lib/card.tsx";
import { readImage, saveImage } from "@/lib/images.ts";

export const runtime = "nodejs";

// Body: { content: { tag, hook, points }, palette, layout, illustrationId? }. Draws the card and saves it as an image.
// Quick (no AI involved), so the text can be edited and the card redrawn without making a new cartoon.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body) return badRequest("Request body must be a JSON object.");
  const content = cleanContent((body.content ?? {}) as object);
  if (!content.hook) return badRequest("Write a hook for the card.");
  const palette = (body.palette ?? "cream") as Palette;
  const layout = (body.layout ?? "portrait") as Layout;
  if (!(palette in PALETTES)) return badRequest(`"palette" must be one of: ${Object.keys(PALETTES).join(", ")}.`);
  if (!(layout in LAYOUTS)) return badRequest(`"layout" must be one of: ${Object.keys(LAYOUTS).join(", ")}.`);

  let illustration = null;
  if (typeof body.illustrationId === "string") {
    const file = await readImage(body.illustrationId);
    if (!file) return badRequest("The cartoon is missing. Make it again.");
    illustration = { data: file.data, mime: file.record.mime };
  }
  try {
    const png = await renderCard({ content, palette, layout, illustration });
    const image = await saveImage(png, "image/png", "generated", content.hook);
    return Response.json({ image: { id: image.id } }, { status: 201 });
  } catch (error) {
    console.error("Card rendering failed:", error);
    return Response.json({ error: `Couldn't draw the card: ${(error as Error).message}` }, { status: 500 });
  }
}
