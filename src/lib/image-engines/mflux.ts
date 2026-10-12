// mflux: FLUX.2 Klein on Apple silicon Macs through Apple's MLX. Installed with: uv tool install mflux
// Each image runs the mflux command line tool; the first run downloads the model (about 15 GB).
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { OLLAMA_MODEL, OLLAMA_URL } from "../ollama.ts";
import { ImageEngineError, type ImageEngine, type ImageRequest } from "./types.ts";

const COMMAND = process.env.MFLUX_COMMAND ?? "mflux-generate-flux2";
// flux2-klein-4b: fast (4 steps), Apache 2.0. 8-bit quantization keeps it within a 16 GB Mac's memory.
const MODEL = process.env.MFLUX_MODEL ?? "flux2-klein-4b";
const STEPS = process.env.MFLUX_STEPS ?? "4";
const QUANTIZE = process.env.MFLUX_QUANTIZE ?? "8";

const INSTALL = "brew install uv && uv tool install --upgrade mflux";

// uv puts tools in ~/.local/bin, which a server started from an app or IDE may not have on its PATH.
async function findCommand(): Promise<string | null> {
  if (COMMAND.includes("/")) return (await isExecutable(COMMAND)) ? COMMAND : null;
  const dirs = [...(process.env.PATH ?? "").split(delimiter), join(homedir(), ".local", "bin"), "/opt/homebrew/bin"];
  for (const dir of dirs) {
    const path = join(/*turbopackIgnore: true*/ dir, COMMAND);
    if (dir && (await isExecutable(path))) return path;
  }
  return null;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Frees the text model's memory first: on a 16 GB Mac both at once would push the system into swap.
async function unloadTextModel(): Promise<void> {
  try {
    await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, keep_alive: 0 }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Ollama not running: nothing to free.
  }
}

async function generate({ prompt, width, height, onProgress, signal }: ImageRequest): Promise<Buffer> {
  const command = await findCommand();
  if (!command) {
    throw new ImageEngineError("engine_missing", "mflux isn't installed. Install it in a terminal, then try again:", INSTALL);
  }
  await unloadTextModel();

  const dir = await mkdtemp(join(tmpdir(), "mflux-"));
  const output = join(dir, "image.png");
  const args = [
    "--model", MODEL,
    "--prompt", prompt,
    "--width", String(width),
    "--height", String(height),
    "--steps", STEPS,
    "--seed", String(Math.floor(Math.random() * 2 ** 31)),
    "--output", output,
    ...(QUANTIZE ? ["-q", QUANTIZE] : []),
  ];

  try {
    const log = await new Promise<string>((resolve, reject) => {
      const child = spawn(/*turbopackIgnore: true*/ command, args, { stdio: ["ignore", "pipe", "pipe"] });
      let tail = "";
      const onData = (bytes: Buffer) => {
        const text = bytes.toString();
        tail = (tail + text).slice(-4000);
        // Progress bars redraw with \r; the last "n/m" on a line is the current count.
        for (const line of text.split(/[\r\n]/)) {
          const match = line.match(/(\d+)\/(\d+)\s*\[/);
          if (!match) continue;
          const downloading = /fetch|download/i.test(line);
          onProgress?.({
            completed: Number(match[1]),
            total: Number(match[2]),
            label: downloading ? "Downloading the image model (first time only, about 15 GB)" : undefined,
          });
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      const abort = () => child.kill("SIGTERM");
      signal?.addEventListener("abort", abort, { once: true });
      child.on("error", (error) => reject(new ImageEngineError("engine_missing", `Couldn't start mflux: ${error.message}`, INSTALL)));
      child.on("close", (code) => {
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted) reject(new DOMException("Stopped", "AbortError"));
        else if (code === 0) resolve(tail);
        else reject(new ImageEngineError("generation_failed", mfluxError(tail)));
      });
    });
    try {
      return await readFile(output);
    } catch {
      throw new ImageEngineError("generation_failed", `mflux finished but didn't save an image. ${lastLines(log)}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function mfluxError(log: string): string {
  if (/out of memory|insufficient memory|metal.*(alloc|memory)/i.test(log)) {
    return "Not enough memory to make the image. Close other apps and try again, or set MFLUX_QUANTIZE=4.";
  }
  if (/401|403|gated|access to model/i.test(log)) {
    return "Hugging Face refused the model download. Run `hf auth login` in a terminal, then try again.";
  }
  if (/no space left/i.test(log)) return "The disk is full; the model needs about 15 GB free.";
  return `mflux failed. ${lastLines(log)}`;
}

function lastLines(log: string): string {
  return log.split(/[\r\n]+/).filter((line) => line.trim()).slice(-3).join(" ").slice(0, 400);
}

export const mfluxEngine: ImageEngine = {
  id: "mflux",
  label: "mflux (FLUX.2 Klein on this Mac)",
  generate,
  async check() {
    if (process.platform !== "darwin" || process.arch !== "arm64") {
      return { ready: false, message: "mflux only runs on Macs with Apple silicon. Use ComfyUI on this computer." };
    }
    return (await findCommand())
      ? { ready: true }
      : { ready: false, message: "mflux isn't installed yet. Install it in a terminal:", command: INSTALL };
  },
};
