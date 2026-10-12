import { badRequest, readJsonObject } from "@/lib/api.ts";
import { IMAGE_MODEL, IMAGE_SIZES, generateImage, type ImageSize } from "@/lib/images.ts";
import { OllamaError } from "@/lib/ollama.ts";

export const runtime = "nodejs";

// Body: { prompt, size }. Streams NDJSON: {"progress": {completed, total}} lines while the image is made,
// then {"image": {id}} or {"error", "code"}. Leaving the page stops the generation.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return badRequest(`"prompt" is required.`);
  if (prompt.length > 2000) return badRequest(`"prompt" must be at most 2,000 characters.`);
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
        const image = await generateImage(prompt, size, (progress) => send({ progress }), request.signal);
        send({ image: { id: image.id } });
      } catch (error) {
        if (!request.signal.aborted) {
          console.error("Image generation failed:", (error as Error).message);
          send({
            error: (error as Error).message,
            code: error instanceof OllamaError ? error.code : "generation_failed",
            model: IMAGE_MODEL,
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
