// Server-only: the Video Studio's queue of short videos, in the video_jobs and video_job_events tables.
// A job goes through the stages below in order; the Python worker (worker/) claims one job at a time over the
// worker API, runs its next unfinished stage, reports the result and moves on. Finished stages are remembered,
// so after a crash or restart the worker resumes where it stopped. Files live in data/videos/<job id>/.
import { randomUUID } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";
import { db, readSetting, writeSetting } from "./db.ts";

export const VIDEO_DIR = join(process.cwd(), "data", "videos");

export const VIDEO_STAGES = ["script", "visuals", "audio", "render", "qc"] as const;
export type VideoStage = (typeof VIDEO_STAGES)[number];

export const VIDEO_STATUSES = [
  // A video you made yourself, still arriving or being converted (video-uploads.ts); the worker never claims it.
  "UPLOADING",
  "WAITING",
  "GENERATING_SCRIPT",
  "GENERATING_VISUALS",
  "GENERATING_AUDIO",
  "RENDERING",
  "QUALITY_CHECK",
  "AWAITING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "FAILED",
  "RETRYING",
  "CANCELLED",
] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

const STAGE_STATUS: Record<VideoStage, VideoStatus> = {
  script: "GENERATING_SCRIPT",
  visuals: "GENERATING_VISUALS",
  audio: "GENERATING_AUDIO",
  render: "RENDERING",
  qc: "QUALITY_CHECK",
};
const RUNNING_STATUSES: VideoStatus[] = Object.values(STAGE_STATUS);
// Statuses a job can still be picked up from by the worker.
const QUEUED_STATUSES: VideoStatus[] = ["WAITING", "RETRYING"];

export const MAX_ATTEMPTS = 3;
export const LEASE_MS = 2 * 60 * 1000;

export function isVideoStage(value: unknown): value is VideoStage {
  return typeof value === "string" && (VIDEO_STAGES as readonly string[]).includes(value);
}

// narration: what the voice says during this scene (the script's narration is these joined); older scripts don't have it.
// motion_prompt: how the scene's LTX clip moves (the worker uses a gentle default when it's missing).
// image_source / clip_source: "upload" when you replaced the picture or the clip with your own; the worker keeps those.
export type VideoScene = {
  narration?: string;
  image_prompt: string;
  motion_prompt?: string;
  on_screen_text: string;
  image?: string | null;
  image_source?: "upload" | null;
  clip_source?: "upload" | null;
};

export type VideoScript = {
  title: string;
  topic: string;
  narration: string;
  scenes: VideoScene[];
  post_caption: string;
  hashtags: string[];
  mood: string;
  style: string;
};

// What to do again on the next run, for the Video Studio's "regenerate" buttons (0-based indexes): scenes are drawn
// again (and animated again); clips are only animated again, from the image they have.
export type VideoRedo = { scenes?: number[]; clips?: number[] };

// One caption shown on screen (2-3 words), with its timing in seconds. The audio stage makes them from the
// narration; you can reword them before a re-render.
export type CaptionGroup = { text: string; start: number; end: number };

export type VideoJob = {
  id: string;
  topic: string;
  seriesId: string | null;
  status: VideoStatus;
  stage: VideoStage | null;
  progress: number;
  attempts: number;
  error: string | null;
  script: VideoScript | null;
  scenes: VideoScene[];
  // Files made so far, as paths relative to the job's folder (narration, captions, video...), plus timings.
  assets: Record<string, unknown>;
  outputPath: string | null;
  qc: Record<string, unknown> | null;
  completedStages: VideoStage[];
  redo: VideoRedo | null;
  workerId: string | null;
  leaseUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

type VideoJobRow = {
  id: string;
  topic: string;
  series_id: string | null;
  status: string;
  stage: string | null;
  progress: number;
  attempts: number;
  error: string | null;
  script: string | null;
  scenes: string | null;
  assets: string | null;
  output_path: string | null;
  qc: string | null;
  completed_stages: string;
  redo: string | null;
  worker_id: string | null;
  lease_until: string | null;
  created_at: string;
  updated_at: string;
};

function parse<T>(text: string | null, fallback: T): T {
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function toJob(row: VideoJobRow): VideoJob {
  return {
    id: row.id,
    topic: row.topic,
    seriesId: row.series_id,
    status: row.status as VideoStatus,
    stage: isVideoStage(row.stage) ? row.stage : null,
    progress: row.progress,
    attempts: row.attempts,
    error: row.error,
    script: parse(row.script, null),
    scenes: parse(row.scenes, []),
    assets: parse(row.assets, {}),
    outputPath: row.output_path,
    qc: parse(row.qc, null),
    completedStages: parse<string[]>(row.completed_stages, []).filter(isVideoStage),
    redo: parse(row.redo, null),
    workerId: row.worker_id,
    leaseUntil: row.lease_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function jobDir(id: string): string {
  return join(VIDEO_DIR, id);
}

// A path the worker reports, made relative to the job's folder. Null when it points outside that folder.
export function jobRelativePath(id: string, path: string): string | null {
  const dir = jobDir(id);
  const relativePath = relative(dir, resolve(dir, path));
  return relativePath && !relativePath.startsWith("..") && !relativePath.includes(`..${sep}`) ? relativePath.split(sep).join("/") : null;
}

export function nextStage(completed: VideoStage[]): VideoStage | null {
  return VIDEO_STAGES.find((stage) => !completed.includes(stage)) ?? null;
}

// --- Reading and creating ---

export function getVideoJob(id: string): VideoJob | null {
  const row = db().prepare("SELECT * FROM video_jobs WHERE id = ?").get(id) as VideoJobRow | undefined;
  return row ? toJob(row) : null;
}

export function listVideoJobs(): VideoJob[] {
  return (db().prepare("SELECT * FROM video_jobs ORDER BY created_at DESC").all() as VideoJobRow[]).map(toJob);
}

// motion: false keeps this video's scenes as still images even when the worker has VIDEO_MOTION=ltx.
export function createVideoJob(topic: string, seriesId: string | null = null, motion = true): VideoJob {
  const now = new Date().toISOString();
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO video_jobs (id, topic, series_id, status, stage, assets, created_at, updated_at)
       VALUES (?, ?, ?, 'WAITING', 'script', ?, ?, ?)`,
    )
    .run(id, topic, seriesId, motion ? null : JSON.stringify({ motion: false }), now, now);
  logVideoEvent(id, null, "info", "Added to the queue");
  return getVideoJob(id)!;
}

// Earlier jobs with the same topic (ignoring case and spacing), for the duplicate check.
export function sameTopicJobs(id: string, topic: string): VideoJob[] {
  const normal = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
  return listVideoJobs().filter(
    (job) => job.id !== id && normal(job.topic) === normal(topic) && !["CANCELLED", "REJECTED", "FAILED"].includes(job.status),
  );
}

// --- Events ---

export type VideoEvent = { id: number; jobId: string; stage: string | null; level: string; message: string; data: unknown; at: string };

export function logVideoEvent(jobId: string, stage: string | null, level: "info" | "warn" | "error", message: string, data?: unknown) {
  try {
    db()
      .prepare("INSERT INTO video_job_events (job_id, stage, level, message, data, at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(jobId, stage, level, message.slice(0, 2000), data === undefined ? null : JSON.stringify(data), new Date().toISOString());
  } catch (error) {
    console.error("Could not log a video event:", error);
  }
}

export function listVideoEvents(jobId: string, limit = 200): VideoEvent[] {
  const rows = db()
    .prepare("SELECT * FROM video_job_events WHERE job_id = ? ORDER BY id DESC LIMIT ?")
    .all(jobId, limit) as { id: number; job_id: string; stage: string | null; level: string; message: string; data: string | null; at: string }[];
  return rows.reverse().map((row) => ({
    id: row.id,
    jobId: row.job_id,
    stage: row.stage,
    level: row.level,
    message: row.message,
    data: parse(row.data, null),
    at: row.at,
  }));
}

// --- The worker's side ---

function leaseUntil(now = Date.now()): string {
  return new Date(now + LEASE_MS).toISOString();
}

// Gives the worker the next job to work on, or null. A worker first gets back a job it was already holding (so it
// resumes after a restart), then the oldest queued job, then a running job whose worker stopped renewing its lease.
// node:sqlite is synchronous and the server is one process, so the select and update can't interleave with another claim.
export function claimVideoJob(workerId: string): VideoJob | null {
  const now = new Date().toISOString();
  const running = RUNNING_STATUSES.map(() => "?").join(", ");
  const queued = QUEUED_STATUSES.map(() => "?").join(", ");
  const row = db()
    .prepare(
      `SELECT * FROM video_jobs
       WHERE status IN (${queued}) OR (status IN (${running}) AND (worker_id = ? OR lease_until IS NULL OR lease_until < ?))
       ORDER BY (worker_id = ?) DESC, created_at
       LIMIT 1`,
    )
    .get(...QUEUED_STATUSES, ...RUNNING_STATUSES, workerId, now, workerId) as VideoJobRow | undefined;
  if (!row) return null;
  const job = toJob(row);
  const stage = nextStage(job.completedStages);
  if (!stage) {
    finishVideoJob(job.id);
    return null;
  }
  db()
    .prepare("UPDATE video_jobs SET status = ?, stage = ?, worker_id = ?, lease_until = ?, error = NULL, updated_at = ? WHERE id = ?")
    .run(STAGE_STATUS[stage], stage, workerId, leaseUntil(), now, job.id);
  if (job.workerId !== workerId || QUEUED_STATUSES.includes(job.status)) {
    logVideoEvent(job.id, stage, "info", `Worker ${workerId} picked it up at the ${stage} stage`);
  }
  return getVideoJob(job.id);
}

function finishVideoJob(id: string) {
  db()
    .prepare(
      `UPDATE video_jobs SET status = 'AWAITING_APPROVAL', stage = NULL, progress = 1, worker_id = NULL, lease_until = NULL,
         redo = NULL, updated_at = ? WHERE id = ?`,
    )
    .run(new Date().toISOString(), id);
  logVideoEvent(id, null, "info", "Ready for your review");
}

export type WorkerCheck = { ok: true; job: VideoJob } | { ok: false; status: number; error: string };

// The worker may only change a job it holds; a cancelled or reassigned job tells it to stop.
export function heldJob(id: string, workerId: string): WorkerCheck {
  const job = getVideoJob(id);
  if (!job) return { ok: false, status: 404, error: "No such video job." };
  if (job.status === "CANCELLED") return { ok: false, status: 409, error: "The job was cancelled." };
  if (job.workerId !== workerId || !RUNNING_STATUSES.includes(job.status)) {
    return { ok: false, status: 409, error: "This worker doesn't hold the job any more." };
  }
  return { ok: true, job };
}

export function renewLease(id: string, workerId: string): boolean {
  const result = db()
    .prepare("UPDATE video_jobs SET lease_until = ? WHERE id = ? AND worker_id = ? AND status <> 'CANCELLED'")
    .run(leaseUntil(), id, workerId);
  return Number(result.changes) > 0;
}

export function reportProgress(id: string, workerId: string, progress: number, message?: string, level: "info" | "warn" = "info") {
  db()
    .prepare("UPDATE video_jobs SET progress = ?, lease_until = ?, updated_at = ? WHERE id = ? AND worker_id = ?")
    .run(Math.max(0, Math.min(1, progress)), leaseUntil(), new Date().toISOString(), id, workerId);
  const job = getVideoJob(id);
  if (message && job) logVideoEvent(id, job.stage, level, message);
}

export type StageResult = {
  script?: VideoScript;
  scenes?: VideoScene[];
  assets?: Record<string, unknown>;
  outputPath?: string | null;
  qc?: Record<string, unknown>;
};

// Saves what a stage made and moves the job to its next stage (or to review after the last one).
export function completeStage(job: VideoJob, stage: VideoStage, result: StageResult, seconds?: number): VideoJob {
  const completed = [...new Set([...job.completedStages, stage])];
  const assets = { ...job.assets, ...result.assets };
  if (seconds !== undefined) {
    assets.timings = { ...(assets.timings as Record<string, number> | undefined), [stage]: Math.round(seconds * 10) / 10 };
  }
  const next = nextStage(completed);
  const now = new Date().toISOString();
  db()
    .prepare(
      `UPDATE video_jobs SET script = ?, scenes = ?, assets = ?, output_path = ?, qc = ?, completed_stages = ?,
         status = ?, stage = ?, progress = 0, lease_until = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      JSON.stringify(result.script ?? job.script),
      JSON.stringify(result.scenes ?? job.scenes),
      JSON.stringify(assets),
      result.outputPath === undefined ? job.outputPath : result.outputPath,
      JSON.stringify(result.qc ?? job.qc),
      JSON.stringify(completed),
      next ? STAGE_STATUS[next] : job.status,
      next,
      leaseUntil(),
      now,
      job.id,
    );
  logVideoEvent(job.id, stage, "info", `Finished ${stage}${seconds === undefined ? "" : ` in ${seconds.toFixed(1)} s`}`);
  if (!next) finishVideoJob(job.id);
  return getVideoJob(job.id)!;
}

// A failed stage is tried again (up to MAX_ATTEMPTS in all) unless the worker says retrying can't help.
export function failStage(job: VideoJob, stage: VideoStage, error: string, retryable: boolean): VideoJob {
  const attempts = job.attempts + 1;
  const giveUp = !retryable || attempts >= MAX_ATTEMPTS;
  db()
    .prepare("UPDATE video_jobs SET status = ?, attempts = ?, error = ?, worker_id = NULL, lease_until = NULL, updated_at = ? WHERE id = ?")
    .run(giveUp ? "FAILED" : "RETRYING", attempts, error.slice(0, 2000), new Date().toISOString(), job.id);
  logVideoEvent(job.id, stage, "error", giveUp ? `Failed at ${stage}: ${error}` : `Attempt ${attempts} failed at ${stage}, will retry: ${error}`);
  return getVideoJob(job.id)!;
}

// --- The user's side ---

export type VideoJobChanges = { script?: VideoScript; scenes?: VideoScene[]; assets?: Record<string, unknown> };

export function updateVideoJob(id: string, changes: VideoJobChanges): void {
  const job = getVideoJob(id);
  if (!job) return;
  db()
    .prepare("UPDATE video_jobs SET script = ?, scenes = ?, assets = ?, updated_at = ? WHERE id = ?")
    .run(
      JSON.stringify(changes.script ?? job.script),
      JSON.stringify(changes.scenes ?? job.scenes),
      JSON.stringify(changes.assets ?? job.assets),
      new Date().toISOString(),
      id,
    );
}

// An approved video you change has to be approved again.
export function unapproveIfEdited(id: string): void {
  const result = db()
    .prepare("UPDATE video_jobs SET status = 'AWAITING_APPROVAL', updated_at = ? WHERE id = ? AND status = 'APPROVED'")
    .run(new Date().toISOString(), id);
  if (Number(result.changes)) logVideoEvent(id, null, "info", "Edited, so it needs your approval again");
}

export function setVideoStatus(id: string, status: "APPROVED" | "REJECTED" | "CANCELLED"): void {
  db()
    .prepare("UPDATE video_jobs SET status = ?, worker_id = NULL, lease_until = NULL, updated_at = ? WHERE id = ?")
    .run(status, new Date().toISOString(), id);
  logVideoEvent(id, null, "info", status === "APPROVED" ? "Approved" : status === "REJECTED" ? "Rejected" : "Cancelled");
}

// What has to be made again when a stage is redone: everything that uses its output.
const DEPENDENTS: Record<VideoStage, VideoStage[]> = {
  script: ["script", "visuals", "audio", "render", "qc"],
  visuals: ["visuals", "render", "qc"],
  audio: ["audio", "render", "qc"],
  render: ["render", "qc"],
  qc: ["qc"],
};

// Queues the job again to redo these stages (and the ones that depend on them), keeping everything else: a new
// scene image doesn't redo the narration. With redo.scenes, only those scenes' images are drawn again.
// Also how a failed job is retried (from the stage that failed).
export function redoVideoStages(id: string, stages: VideoStage[], redo: VideoRedo | null = null, note?: string): void {
  const job = getVideoJob(id);
  if (!job) return;
  const again = new Set(stages.flatMap((stage) => DEPENDENTS[stage]));
  const completed = job.completedStages.filter((stage) => !again.has(stage));
  // The visuals stage keeps scene images and clips it finds (so an interrupted run resumes); when all of them are to
  // be made again (a new script, or a full redo), forget them first.
  let assets = job.assets;
  if (again.has("visuals") && !redo?.scenes?.length && !redo?.clips?.length) {
    const files = Object.fromEntries(
      Object.entries((job.assets.files as Record<string, string> | undefined) ?? {}).filter(
        ([name]) => !name.startsWith("scene-") && !name.startsWith("clip-"),
      ),
    );
    assets = { ...job.assets, files, image_seconds: {}, clip_seconds: {}, motion_stills: [] };
  }
  db()
    .prepare(
      `UPDATE video_jobs SET status = 'WAITING', stage = ?, progress = 0, attempts = 0, error = NULL, completed_stages = ?,
         redo = ?, assets = ?, worker_id = NULL, lease_until = NULL, updated_at = ? WHERE id = ?`,
    )
    .run(nextStage(completed), JSON.stringify(completed), redo && JSON.stringify(redo), JSON.stringify(assets), new Date().toISOString(), id);
  logVideoEvent(id, nextStage(completed), "info", note ?? `Queued again to redo ${stages.join(", ")}`);
}

export function deleteVideoJob(id: string): void {
  db().prepare("DELETE FROM video_job_events WHERE job_id = ?").run(id);
  db().prepare("DELETE FROM video_jobs WHERE id = ?").run(id);
}

// --- Worker status (kept in the settings table) ---

export type WorkerStatus = {
  workerId: string;
  lastHeartbeat: string;
  jobId: string | null;
  stage: string | null;
  gpu: string | null;
  freeDiskGb: number | null;
  version: string | null;
};

export function saveWorkerStatus(status: WorkerStatus): void {
  writeSetting("video_worker", status);
}

export function readWorkerStatus(): (WorkerStatus & { online: boolean }) | null {
  const status = readSetting<WorkerStatus>("video_worker");
  if (!status) return null;
  return { ...status, online: Date.now() - Date.parse(status.lastHeartbeat) < 60_000 };
}
