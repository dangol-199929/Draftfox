// Server-only: post images, uploaded or made by a local image model (mflux, ComfyUI or Ollama).
// Files are kept in data/images on this machine; the database only stores their names.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deleteImageRecord, getImage, imageInUse, insertImage, logEvent, type ImageRecord } from "./db.ts";
import { ImageEngineError, imageEngine, type ImageProgress } from "./image-engines/index.ts";
import { generateText } from "./ollama.ts";

const IMAGE_DIR = join(process.cwd(), "data", "images");

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

// One image at a time: image models need most of the computer's memory or graphics card.
const imageLock = globalThis as typeof globalThis & { imageBusy?: boolean };

// Makes one image with the configured engine (mflux, ComfyUI or Ollama; see image-engines) and saves it.
export async function generateImage(
  prompt: string,
  size: ImageSize,
  onProgress?: (progress: ImageProgress) => void,
  signal?: AbortSignal,
): Promise<ImageRecord> {
  if (imageLock.imageBusy) throw new ImageEngineError("busy", "Another image is being made. Wait for it to finish.");
  imageLock.imageBusy = true;
  try {
    const { width, height } = IMAGE_SIZES[size];
    const data = await imageEngine().generate({ prompt, width, height, onProgress, signal });
    const mime = sniffImageType(data);
    if (!mime) throw new ImageEngineError("generation_failed", "The image engine returned something that isn't an image.");
    return await saveImage(data, mime, "generated", prompt);
  } finally {
    imageLock.imageBusy = false;
  }
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
