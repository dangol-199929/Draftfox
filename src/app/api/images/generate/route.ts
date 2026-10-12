import { badRequest, readJsonObject } from "@/lib/api.ts";
import { cartoonPrompt } from "@/lib/card.tsx";
import { ImageEngineError } from "@/lib/image-engines/index.ts";
import { IMAGE_SIZES, generateImage, type ImageSize } from "@/lib/images.ts";

export const runtime = "nodejs";

// Body: { prompt, size, style? ("cartoon" for a card's illustration) }. Streams NDJSON: {"progress": {completed, total}} lines while the image is made,
// then {"image": {id}} or {"error", "code", "command"?}. Leaving the page stops the generation.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return badRequest(`"prompt" is required.`);
  if (prompt.length > 2000) return badRequest(`"prompt" must be at most 2,000 characters.`);
  // "cartoon": a simple 2D illustration for a card, in the style all cards share.
  const cartoon = body?.style === "cartoon";
  const size = (body?.size ?? "landscape") as ImageSize;
  if (!(size in IMAGE_SIZES)) return badRequest(`"size" must be one of: ${Object.keys(IMAGE_SIZES).join(", ")}.`);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: object) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
        } catch {
          // The page went away.
        }
      };
      try {
        const image = await generateImage(cartoon ? cartoonPrompt(prompt) : prompt, size, (progress) => send({ progress }), request.signal);
        send({ image: { id: image.id } });
      } catch (error) {
        if (!request.signal.aborted) {
          console.error("Image generation failed:", (error as Error).message);
          send({
            error: (error as Error).message,
            code: error instanceof ImageEngineError ? error.code : "generation_failed",
            ...(error instanceof ImageEngineError && error.command && { command: error.command }),
          });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" } });
}
