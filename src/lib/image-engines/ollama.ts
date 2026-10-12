// Ollama's experimental image generation (macOS). Turned off in Ollama after 0.32.5; kept for when it returns.
import { OLLAMA_URL } from "../ollama.ts";
import { ImageEngineError, type ImageEngine, type ImageRequest } from "./types.ts";

const MODEL = process.env.OLLAMA_IMAGE_MODEL ?? "x/flux2-klein";

type ImageChunk = { image?: string; images?: string[]; completed?: number; total?: number; error?: string };

async function generate({ prompt, width, height, onProgress, signal }: ImageRequest): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, prompt, width, height, stream: true }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ImageEngineError("engine_unreachable", `Could not reach Ollama at ${OLLAMA_URL}. Is it running?`, "ollama serve");
  }
  if (response.status === 404) {
    throw new ImageEngineError("model_missing", `The image model "${MODEL}" isn't downloaded.`, `ollama pull ${MODEL}`);
  }
  if (!response.ok || !response.body) throw new ImageEngineError("generation_failed", ollamaError(response.status, await response.text()));

  // NDJSON: progress lines, then one with the image as base64 PNG.
  const decoder = new TextDecoder();
  let buffer = "";
  let image: string | undefined;
  const handle = (line: string) => {
    if (!line.trim()) return;
    const chunk = JSON.parse(line) as ImageChunk;
    if (chunk.error) throw new ImageEngineError("generation_failed", ollamaError(500, chunk.error));
    if (typeof chunk.completed === "number" && typeof chunk.total === "number" && chunk.total > 0) {
      onProgress?.({ completed: chunk.completed, total: chunk.total });
    }
    image = chunk.image ?? chunk.images?.[0] ?? image;
  };
  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(handle);
  }
  handle(buffer);
  if (!image) throw new ImageEngineError("generation_failed", "The image model finished without returning an image.");
  return Buffer.from(image.replace(/^data:image\/\w+;base64,/, ""), "base64");
}

function ollamaError(status: number, detail: string): string {
  if (/image generation models are not currently supported/i.test(detail)) {
    return "This version of Ollama can't make images: Ollama turned image generation off after version 0.32.5. Set IMAGE_ENGINE=mflux (Mac) or comfyui instead.";
  }
  if (/memory/i.test(detail)) return "Not enough memory to make the image. Close other apps and try again.";
  return `Ollama returned ${status}: ${detail.slice(0, 300)}`;
}

export const ollamaEngine: ImageEngine = {
  id: "ollama",
  label: `Ollama (${MODEL})`,
  generate,
  async check() {
    try {
      const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
      const { models = [] } = (await response.json()) as { models?: { name: string }[] };
      const found = models.some((model) => model.name === MODEL || model.name === `${MODEL}:latest`);
      return found
        ? { ready: true }
        : { ready: false, message: `The image model "${MODEL}" isn't downloaded.`, command: `ollama pull ${MODEL}` };
    } catch {
      return { ready: false, message: `Ollama isn't running at ${OLLAMA_URL}.`, command: "ollama serve" };
    }
  },
};
