// Server-only: one user of the graphics card at a time. This PC has 8 GB of video memory, enough for one model
// (Ollama's text model or ComfyUI's image model) but not both, so every GPU use takes the lease in the gpu_lease
// table first. Requests made from the app (writing a post, an image, auto-posting) go first: while one waits, the
// video worker can't take the lease, and the worker gives it back between stages.
import { randomUUID } from "node:crypto";
import { db } from "./db.ts";

export type GpuPriority = "interactive" | "background";
export type GpuLease = { holder: string; purpose: string; acquiredAt: string; expiresAt: string };

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const COMFYUI_URL = (process.env.COMFYUI_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const POLL_MS = 250;

// Holders inside this server are "server:<pid>:<id>", so a lease left by a server that crashed or restarted is ignored.
const SERVER_PREFIX = `server:${process.pid}:`;

const state = globalThis as typeof globalThis & { gpuInteractiveWaiting?: number };

export class GpuBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GpuBusyError";
  }
}

type LeaseRow = { holder: string; purpose: string; acquired_at: string; expires_at: string };

export function currentGpuLease(now = Date.now()): GpuLease | null {
  const row = db().prepare("SELECT * FROM gpu_lease WHERE id = 1").get() as LeaseRow | undefined;
  if (!row || isStale(row, now)) return null;
  return { holder: row.holder, purpose: row.purpose, acquiredAt: row.acquired_at, expiresAt: row.expires_at };
}

function isStale(row: LeaseRow, now: number): boolean {
  if (Date.parse(row.expires_at) < now) return true;
  return row.holder.startsWith("server:") && !row.holder.startsWith(SERVER_PREFIX);
}

export function interactiveWaiting(): number {
  return state.gpuInteractiveWaiting ?? 0;
}

// No background GPU work (the video worker) from 20:40 to 21:20 Sydney time. The lease isn't handed out from a few
// minutes before, so a scene that's just started can't run into it.
const QUIET_START = 20 * 60 + 40;
const QUIET_END = 21 * 60 + 20;
const QUIET_LEAD_MINUTES = 3;
export const GPU_QUIET_HOURS = "20:40-21:20 Sydney time";
const sydneyClock = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function inGpuQuietHours(now = Date.now()): boolean {
  const parts = Object.fromEntries(sydneyClock.formatToParts(now).map((part) => [part.type, part.value]));
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return minute >= QUIET_START - QUIET_LEAD_MINUTES && minute < QUIET_END;
}

// Takes the lease if it's free (or already this holder's). Background holders don't get it while an app request
// waits, or in the quiet hours. node:sqlite is synchronous, so the read and write can't interleave with another
// request in this server.
export function tryAcquireGpu(holder: string, purpose: string, ttlMs: number, priority: GpuPriority): boolean {
  const now = Date.now();
  if (priority === "background" && inGpuQuietHours(now)) return false;
  const row = db().prepare("SELECT * FROM gpu_lease WHERE id = 1").get() as LeaseRow | undefined;
  if (row && !isStale(row, now) && row.holder !== holder) return false;
  if (priority === "background" && interactiveWaiting() > 0 && row?.holder !== holder) return false;
  db()
    .prepare(
      `INSERT INTO gpu_lease (id, holder, purpose, acquired_at, expires_at) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET holder = excluded.holder, purpose = excluded.purpose,
         acquired_at = CASE WHEN gpu_lease.holder = excluded.holder THEN gpu_lease.acquired_at ELSE excluded.acquired_at END,
         expires_at = excluded.expires_at`,
    )
    .run(holder, purpose, new Date(now).toISOString(), new Date(now + ttlMs).toISOString());
  return true;
}

export function releaseGpu(holder: string): void {
  db().prepare("DELETE FROM gpu_lease WHERE id = 1 AND holder = ?").run(holder);
}

export type GpuWaitOptions = {
  ttlMs?: number;
  waitMs?: number;
  signal?: AbortSignal;
  onWait?: (lease: GpuLease | null) => void;
};

// Waits for the lease (as an app request), runs `work`, and always gives the lease back.
export async function withGpu<T>(purpose: string, work: () => Promise<T>, options: GpuWaitOptions = {}): Promise<T> {
  const release = await acquireGpu(purpose, options);
  try {
    return await work();
  } finally {
    release();
  }
}

// Waits for the lease (as an app request) and returns the function that gives it back.
export async function acquireGpu(purpose: string, options: GpuWaitOptions = {}): Promise<() => void> {
  const holder = `${SERVER_PREFIX}${randomUUID()}`;
  const ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  const waitMs = options.waitMs ?? 15 * 60 * 1000;
  const deadline = Date.now() + waitMs;
  let waiting = false;
  try {
    while (!tryAcquireGpu(holder, purpose, ttlMs, "interactive")) {
      if (!waiting) {
        waiting = true;
        state.gpuInteractiveWaiting = interactiveWaiting() + 1;
        options.onWait?.(currentGpuLease());
      }
      if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("Stopped", "AbortError");
      if (Date.now() > deadline) {
        const lease = currentGpuLease();
        throw new GpuBusyError(`The graphics card is still busy${lease ? ` (${lease.purpose})` : ""}. Try again in a few minutes.`);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  } finally {
    if (waiting) state.gpuInteractiveWaiting = Math.max(0, interactiveWaiting() - 1);
  }
  return () => releaseGpu(holder);
}

// Ollama keeps a model in video memory for a few minutes after use; this unloads them now, before ComfyUI needs it.
export async function unloadOllamaModels(): Promise<string[]> {
  try {
    const running = (await (await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(5000) })).json()) as {
      models?: { name: string }[];
    };
    const names = (running.models ?? []).map((model) => model.name);
    await Promise.all(
      names.map((model) =>
        fetch(`${OLLAMA_URL}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, keep_alive: 0 }),
          signal: AbortSignal.timeout(30_000),
        }),
      ),
    );
    return names;
  } catch {
    // Ollama not running: nothing to unload.
    return [];
  }
}

// Asks ComfyUI to drop its models from video memory, so Ollama has room again.
export async function freeComfyUi(): Promise<void> {
  try {
    await fetch(`${COMFYUI_URL}/free`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // ComfyUI not running: nothing to free.
  }
}
