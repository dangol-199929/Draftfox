// Picks the image engine: IMAGE_ENGINE if set (mflux, comfyui or ollama), otherwise mflux on Apple silicon Macs
// and ComfyUI everywhere else.
import { comfyuiEngine } from "./comfyui.ts";
import { mfluxEngine } from "./mflux.ts";
import { ollamaEngine } from "./ollama.ts";
import type { ImageEngine } from "./types.ts";

export { ImageEngineError, type ImageProgress } from "./types.ts";

const ENGINES: Record<ImageEngine["id"], ImageEngine> = { mflux: mfluxEngine, comfyui: comfyuiEngine, ollama: ollamaEngine };

export function imageEngine(): ImageEngine {
  const chosen = process.env.IMAGE_ENGINE?.trim().toLowerCase();
  if (chosen && chosen in ENGINES) return ENGINES[chosen as ImageEngine["id"]];
  return process.platform === "darwin" && process.arch === "arm64" ? mfluxEngine : comfyuiEngine;
}
