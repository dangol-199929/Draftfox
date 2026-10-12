// Server-only: post images, uploaded or made by a local image model through Ollama.
// Files are kept in data/images on this machine; the database only stores their names.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deleteImageRecord, getImage, imageInUse, insertImage, logEvent, type ImageRecord } from "./db.ts";
import { OLLAMA_URL, OllamaError, generateText } from "./ollama.ts";

const IMAGE_DIR = join(process.cwd(), "data", "images");

// FLUX.2 Klein 4B: about 5.7 GB, fits a 16 GB Mac and may be used commercially (Apache 2.0).
export const IMAGE_MODEL = process.env.OLLAMA_IMAGE_MODEL ?? "x/flux2-klein";

// LinkedIn takes JPG, PNG and GIF. 10 MB is plenty for a post image and keeps uploads quick.
export const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif" };
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// Sizes that suit the LinkedIn feed, in multiples of 16 as the image models expect.
export const IMAGE_SIZES = {
  square: { width: 1024, height: 1024, label: "Square" },
  landscape: { width: 1216, height: 640, label: "Landscape" },
  portrait: { width: 896, height: 1120, label: "Portrait" },
} as const;
export type ImageSize = keyof typeof IMAGE_SIZES;

export async function saveImage(
  data: Uint8Array,
  mime: string,
  source: ImageRecord["source"],
  prompt: string | null = null,
): Promise<ImageRecord> {
  const extension = IMAGE_TYPES[mime];
  if (!extension) throw new Error("Images must be PNG, JPG or GIF.");
  const id = randomUUID();
  const record: ImageRecord = {
    id,
    file: `${id}.${extension}`,
    mime,
    source,
    prompt,
    created_at: new Date().toISOString(),
  };
  await mkdir(IMAGE_DIR, { recursive: true });
  await writeFile(join(IMAGE_DIR, record.file), data);
  insertImage(record);
  logEvent(source === "generated" ? "image_generated" : "image_uploaded");
  return record;
}

export async function readImage(id: string): Promise<{ record: ImageRecord; data: Buffer } | null> {
  const record = getImage(id);
  if (!record) return null;
  try {
    return { record, data: await readFile(join(IMAGE_DIR, record.file)) };
  } catch {
    return null;
  }
}

// Removes the image unless another post still uses it.
export async function removeImageIfUnused(id: string): Promise<void> {
  if (imageInUse(id)) return;
  const record = getImage(id);
  if (!record) return;
  deleteImageRecord(id);
  await rm(join(IMAGE_DIR, record.file), { force: true });
}

// Checks the first bytes, so a renamed file can't pass as an image.
export function sniffImageType(data: Uint8Array): string | null {
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return "image/gif";
  return null;
}

export type ImageProgress = { completed: number; total: number };

type ImageChunk = {
  image?: string;
  images?: string[];
  completed?: number;
  total?: number;
  done?: boolean;
  error?: string;
};

// Makes one image with the local image model. Ollama's image generation is experimental and macOS-only for now.
// Calls onProgress with the diffusion steps done so far, when Ollama reports them.
export async function generateImage(
  prompt: string,
  size: ImageSize,
  onProgress?: (progress: ImageProgress) => void,
  signal?: AbortSignal,
): Promise<ImageRecord> {
  const { width, height } = IMAGE_SIZES[size];
  let response: Response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: IMAGE_MODEL, prompt, width, height, stream: true }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new OllamaError(
      "ollama_unreachable",
      `Could not reach Ollama at ${OLLAMA_URL}. Is it running? Open the Ollama app or run: ollama serve`,
    );
  }
  if (response.status === 404) {
    throw new OllamaError(
      "model_missing",
      `The image model "${IMAGE_MODEL}" is not downloaded. Run: ollama pull ${IMAGE_MODEL}`,
    );
  }
  if (!response.ok || !response.body) {
    const detail = await response.text();
    throw new OllamaError("generation_failed", imageErrorMessage(response.status, detail));
  }

  // NDJSON: progress lines, then one with the image as base64 PNG.
  const decoder = new TextDecoder();
  let buffer = "";
  let image: string | undefined;
  const handle = (line: string) => {
    if (!line.trim()) return;
    const chunk = JSON.parse(line) as ImageChunk;
    if (chunk.error) throw new OllamaError("generation_failed", imageErrorMessage(500, chunk.error));
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

  if (!image) throw new OllamaError("generation_failed", "The image model finished without returning an image.");
  const data = Buffer.from(image.replace(/^data:image\/\w+;base64,/, ""), "base64");
  const mime = sniffImageType(data) ?? "image/png";
  return saveImage(data, mime, "generated", prompt);
}

function imageErrorMessage(status: number, detail: string): string {
  if (/image generation models are not currently supported/i.test(detail)) {
    return "This version of Ollama can't make images: Ollama turned image generation off after version 0.32.5 and plans to bring it back later. Post text still works as before.";
  }
  if (/does not support (generate|image)|not an image|unsupported/i.test(detail)) {
    return `"${IMAGE_MODEL}" can't make images. Set OLLAMA_IMAGE_MODEL to an image model, such as x/flux2-klein.`;
  }
  if (/memory|out of memory|insufficient/i.test(detail)) {
    return "Not enough memory to make the image. Close other apps (or stop a running post generation) and try again.";
  }
  return `Ollama returned ${status}: ${detail.slice(0, 300)}`;
}

const IMAGE_PROMPT_SYSTEM = `You write prompts for an image generator. Given a LinkedIn post, describe one image to go with it.
Rules:
- Describe a concrete scene, objects, setting, lighting and style, in one paragraph under 70 words.
- Prefer clean, professional photography or a simple flat illustration.
- No text, letters, logos, charts with numbers, or real people's faces.
- Reply with the prompt only, no quotes or preamble.`;

// Asks the text model for an image prompt that fits the post.
export async function suggestImagePrompt(postText: string): Promise<string> {
  const prompt = await generateText(`LinkedIn post:\n\n${postText.slice(0, 4000)}`, IMAGE_PROMPT_SYSTEM);
  return prompt.replace(/^["'“]+|["'”]+$/g, "").trim();
}
