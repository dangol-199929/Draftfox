// What every image engine (mflux, ComfyUI, Ollama) takes and returns.

export type ImageProgress = { completed: number; total: number; label?: string };

export type ImageRequest = {
  prompt: string;
  width: number;
  height: number;
  onProgress?: (progress: ImageProgress) => void;
  signal?: AbortSignal;
};

export type ImageEngineErrorCode =
  | "engine_missing"
  | "engine_unreachable"
  | "model_missing"
  | "busy"
  | "generation_failed";

// An Error with a code and, when there's a fix to run, the command for it.
export class ImageEngineError extends Error {
  code: ImageEngineErrorCode;
  command?: string;

  constructor(code: ImageEngineErrorCode, message: string, command?: string) {
    super(message);
    this.code = code;
    this.command = command;
  }
}

export type ImageEngine = {
  id: "mflux" | "comfyui" | "ollama";
  label: string;
  generate(request: ImageRequest): Promise<Buffer>;
  // Whether the engine looks ready, with a reason and a fix when it isn't. Cheap; doesn't load models.
  check(): Promise<{ ready: boolean; message?: string; command?: string }>;
};
