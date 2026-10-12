// Server-only: runs one post generation at a time on the server, independent of any open page.
// Leaving or reloading the Generate page doesn't stop it; the page reconnects and picks up the text.
import { randomUUID } from "node:crypto";
import { latestGeneration, saveGeneration, type GenerationRow } from "./db.ts";
import { OLLAMA_MODEL, OllamaError } from "./ollama.ts";
import { streamLinkedInPost } from "./post.ts";
import type { PostInput } from "./prompts.ts";

export type GenerationStatus = "running" | "done" | "stopped" | "failed";

// What the page sees. `text` is trimmed except while running.
export type GenerationSnapshot = {
  id: string;
  status: GenerationStatus;
  text: string;
  seconds: number | null;
  error?: string;
  code?: string;
  model?: string;
};

type Job = {
  id: string;
  input: PostInput;
  text: string;
  status: GenerationStatus;
  error: string | null;
  code: string | null;
  startedAt: string;
  seconds: number | null;
  controller: AbortController;
  // Called on every new chunk and when the job ends.
  listeners: Set<() => void>;
  // Resolves on the first chunk or when the job ends, whichever comes first.
  started: Promise<void>;
};

// Saving every chunk would write to disk dozens of times a second; once a second keeps a crash's loss small.
const SAVE_INTERVAL = 1000;

// Kept on globalThis so dev hot reloads don't lose a running job.
const globalForJob = globalThis as typeof globalThis & { generationJob?: Job };

export function currentGeneration(): GenerationSnapshot | null {
  const job = globalForJob.generationJob;
  if (job) return snapshot(job);
  // After a server restart: the last one from the database. One still "running" there was cut off.
  const row = latestGeneration();
  if (!row) return null;
  const status = (row.status === "running" ? "stopped" : row.status) as GenerationStatus;
  return {
    id: row.id,
    status,
    text: row.text.trim(),
    seconds: row.seconds,
    ...(row.error && { error: row.error }),
    ...(row.code && { code: row.code }),
  };
}

// Starts a new generation, stopping one that's still running.
export function startGeneration(input: PostInput): Job {
  globalForJob.generationJob?.controller.abort();

  let markStarted = () => {};
  const job: Job = {
    id: randomUUID(),
    input,
    text: "",
    status: "running",
    error: null,
    code: null,
    startedAt: new Date().toISOString(),
    seconds: null,
    controller: new AbortController(),
    listeners: new Set(),
    started: new Promise((resolve) => (markStarted = resolve)),
  };
  globalForJob.generationJob = job;
  save(job);
  void run(job, markStarted);
  return job;
}

export function stopGeneration(): void {
  const job = globalForJob.generationJob;
  if (job?.status === "running") job.controller.abort();
}

export function findGeneration(id: string): Job | null {
  const job = globalForJob.generationJob;
  return job?.id === id ? job : null;
}

// The job's text from the start, then each new chunk, closing when the job ends.
// Cancelling it (the page went away) only stops this stream, never the job.
export function followGeneration(job: Job): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let sent = 0;
  let wake: (() => void) | null = null;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (true) {
        if (job.text.length > sent) {
          controller.enqueue(encoder.encode(job.text.slice(sent)));
          sent = job.text.length;
          return;
        }
        if (job.status !== "running") {
          controller.close();
          return;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          job.listeners.add(resolve);
        });
      }
    },
    cancel() {
      if (wake) job.listeners.delete(wake);
    },
  });
}

export function snapshot(job: Job): GenerationSnapshot {
  return {
    id: job.id,
    status: job.status,
    text: job.status === "running" ? job.text : job.text.trim(),
    seconds: job.seconds,
    ...(job.error && { error: job.error }),
    ...(job.code && { code: job.code }),
    ...(job.code === "model_missing" && { model: OLLAMA_MODEL }),
  };
}

async function run(job: Job, markStarted: () => void) {
  const start = Date.now();
  let lastSave = start;
  try {
    for await (const chunk of streamLinkedInPost(job.input, job.controller.signal)) {
      job.text += chunk;
      markStarted();
      notify(job);
      if (Date.now() - lastSave > SAVE_INTERVAL) {
        lastSave = Date.now();
        save(job);
      }
    }
    job.status = "done";
  } catch (error) {
    if (job.controller.signal.aborted) {
      job.status = "stopped";
    } else {
      console.error("Post generation failed:", error);
      job.status = "failed";
      job.error = (error as Error).message;
      job.code = error instanceof OllamaError ? error.code : "generation_failed";
    }
  } finally {
    job.seconds = (Date.now() - start) / 1000;
    save(job);
    markStarted();
    notify(job);
  }
}

function notify(job: Job) {
  const listeners = [...job.listeners];
  job.listeners.clear();
  for (const listener of listeners) listener();
}

function save(job: Job) {
  const row: GenerationRow = {
    id: job.id,
    input: JSON.stringify(job.input),
    text: job.text,
    status: job.status,
    error: job.error,
    code: job.code,
    started_at: job.startedAt,
    seconds: job.seconds,
  };
  try {
    saveGeneration(row);
  } catch (error) {
    // The post still streams to the page; only the saved copy is missing.
    console.error("Could not save the generation:", error);
  }
}
