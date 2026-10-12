// ComfyUI: runs FLUX.2 Klein on Windows or Linux with an NVIDIA GPU (or anywhere ComfyUI runs), over its HTTP API.
// The built-in workflow below is ComfyUI's "Flux.2 Klein 4B Distilled" text-to-image template in API form.
// To use your own, export it from ComfyUI with "Export (API)" and set COMFYUI_WORKFLOW to the file;
// write {{prompt}}, {{width}}, {{height}} and {{seed}} where those values go.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ImageEngineError, type ImageEngine, type ImageRequest } from "./types.ts";

// The ComfyUI desktop app listens on 8000; the portable and manual installs use 8188.
const URL_BASE = (process.env.COMFYUI_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const WORKFLOW_FILE = process.env.COMFYUI_WORKFLOW;

const MODEL_FILES = {
  unet: process.env.COMFYUI_UNET ?? "flux-2-klein-4b.safetensors",
  clip: process.env.COMFYUI_CLIP ?? "qwen_3_4b.safetensors",
  vae: process.env.COMFYUI_VAE ?? "flux2-vae.safetensors",
};

type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

function builtInWorkflow(prompt: string, width: number, height: number, seed: number): Workflow {
  return {
    "70": { class_type: "UNETLoader", inputs: { unet_name: MODEL_FILES.unet, weight_dtype: "default" } },
    "71": { class_type: "CLIPLoader", inputs: { clip_name: MODEL_FILES.clip, type: "flux2", device: "default" } },
    "72": { class_type: "VAELoader", inputs: { vae_name: MODEL_FILES.vae } },
    "74": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["71", 0] } },
    "76": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["74", 0] } },
    "63": { class_type: "CFGGuider", inputs: { model: ["70", 0], positive: ["74", 0], negative: ["76", 0], cfg: 1 } },
    "61": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "62": { class_type: "Flux2Scheduler", inputs: { steps: 4, width, height } },
    "73": { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    "66": { class_type: "EmptyFlux2LatentImage", inputs: { width, height, batch_size: 1 } },
    "64": {
      class_type: "SamplerCustomAdvanced",
      inputs: { noise: ["73", 0], guider: ["63", 0], sampler: ["61", 0], sigmas: ["62", 0], latent_image: ["66", 0] },
    },
    "65": { class_type: "VAEDecode", inputs: { samples: ["64", 0], vae: ["72", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["65", 0], filename_prefix: "draftfox" } },
  };
}

// Fills the placeholders in a workflow exported from ComfyUI. Numbers are replaced as numbers.
async function customWorkflow(file: string, prompt: string, width: number, height: number, seed: number): Promise<Workflow> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    throw new ImageEngineError("engine_missing", `Couldn't read COMFYUI_WORKFLOW (${file}): ${(error as Error).message}`);
  }
  const filled = text
    .replace(/"\{\{width\}\}"/g, String(width))
    .replace(/"\{\{height\}\}"/g, String(height))
    .replace(/"\{\{seed\}\}"/g, String(seed))
    .replace(/\{\{prompt\}\}/g, JSON.stringify(prompt).slice(1, -1));
  try {
    return JSON.parse(filled) as Workflow;
  } catch {
    throw new ImageEngineError("engine_missing", "COMFYUI_WORKFLOW isn't valid JSON. Export it again with Export (API).");
  }
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${URL_BASE}${path}`, init);
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new ImageEngineError(
      "engine_unreachable",
      `Could not reach ComfyUI at ${URL_BASE}. Open the ComfyUI app (or start it), or set COMFYUI_URL to where it runs.`,
    );
  }
}

async function generate({ prompt, width, height, onProgress, signal }: ImageRequest): Promise<Buffer> {
  const seed = Math.floor(Math.random() * 2 ** 31);
  const workflow = WORKFLOW_FILE
    ? await customWorkflow(WORKFLOW_FILE, prompt, width, height, seed)
    : builtInWorkflow(prompt, width, height, seed);
  const clientId = randomUUID();

  // Progress comes over ComfyUI's websocket; completion is checked over HTTP, so the websocket is optional.
  let socket: WebSocket | null = null;
  try {
    socket = new WebSocket(`${URL_BASE.replace(/^http/, "ws")}/ws?clientId=${clientId}`);
  } catch {
    socket = null;
  }
  let promptId = "";
  socket?.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    try {
      const message = JSON.parse(event.data) as { type: string; data?: { value?: number; max?: number; prompt_id?: string } };
      if (message.type === "progress" && message.data?.max && (!promptId || message.data.prompt_id === promptId)) {
        onProgress?.({ completed: message.data.value ?? 0, total: message.data.max });
      }
    } catch {
      // Not a message we use.
    }
  });

  try {
    const queued = await api("/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      signal,
    });
    const body = (await queued.json().catch(() => ({}))) as {
      prompt_id?: string;
      error?: { message?: string };
      node_errors?: Record<string, { errors?: { message?: string; details?: string }[] }>;
    };
    if (!queued.ok || !body.prompt_id) throw new ImageEngineError(...promptError(body));
    promptId = body.prompt_id;

    const abort = () => void api("/interrupt", { method: "POST" }).catch(() => {});
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const image = await waitForImage(promptId, signal);
      const view = await api(
        `/view?${new URLSearchParams({ filename: image.filename, subfolder: image.subfolder ?? "", type: image.type ?? "output" })}`,
        { signal },
      );
      if (!view.ok) throw new ImageEngineError("generation_failed", `ComfyUI made the image but returned ${view.status} for it.`);
      return Buffer.from(await view.arrayBuffer());
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  } finally {
    socket?.close();
  }
}

type HistoryEntry = {
  outputs?: Record<string, { images?: { filename: string; subfolder?: string; type?: string }[] }>;
  status?: { status_str?: string; completed?: boolean; messages?: [string, { exception_message?: string }][] };
};

async function waitForImage(promptId: string, signal?: AbortSignal) {
  while (true) {
    if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
    const response = await api(`/history/${promptId}`, { signal });
    const history = (await response.json().catch(() => ({}))) as Record<string, HistoryEntry>;
    const entry = history[promptId];
    if (entry?.status?.status_str === "error") {
      const failure = entry.status.messages?.find(([type]) => type === "execution_error")?.[1];
      throw new ImageEngineError("generation_failed", comfyMessage(failure?.exception_message ?? "ComfyUI reported an error."));
    }
    const image = Object.values(entry?.outputs ?? {}).flatMap((output) => output.images ?? [])[0];
    if (image) return image;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

function promptError(body: {
  error?: { message?: string };
  node_errors?: Record<string, { errors?: { message?: string; details?: string }[] }>;
}): [ImageEngineError["code"], string] {
  const details = Object.values(body.node_errors ?? {})
    .flatMap((node) => node.errors ?? [])
    .map((error) => `${error.message ?? ""} ${error.details ?? ""}`.trim());
  const text = [body.error?.message ?? "", ...details].join(" ");
  if (/not in list|value_not_in_list/i.test(text)) {
    return [
      "model_missing",
      `ComfyUI doesn't have the FLUX.2 Klein model files (${MODEL_FILES.unet}, ${MODEL_FILES.clip}, ${MODEL_FILES.vae}). In ComfyUI, open Templates and load "Flux.2 Klein 4B Text to Image" to download them, then try again.`,
    ];
  }
  if (/node.*does not exist|invalid_prompt.*class_type/i.test(text)) {
    return ["engine_missing", "This ComfyUI is too old for FLUX.2 Klein. Update ComfyUI, then try again."];
  }
  return ["generation_failed", comfyMessage(text || "ComfyUI rejected the workflow.")];
}

function comfyMessage(message: string): string {
  if (/out of memory|CUDA out of memory|allocat/i.test(message)) {
    return "The graphics card ran out of memory. Close other GPU apps, or choose a smaller image shape, and try again.";
  }
  return `ComfyUI: ${message.slice(0, 400)}`;
}

export const comfyuiEngine: ImageEngine = {
  id: "comfyui",
  label: "ComfyUI",
  generate,
  async check() {
    try {
      const response = await fetch(`${URL_BASE}/system_stats`, { signal: AbortSignal.timeout(3000) });
      return response.ok ? { ready: true } : { ready: false, message: `ComfyUI at ${URL_BASE} answered ${response.status}.` };
    } catch {
      return {
        ready: false,
        message: `ComfyUI isn't running at ${URL_BASE}. Open the ComfyUI app, or set COMFYUI_URL to where it runs.`,
      };
    }
  },
};
