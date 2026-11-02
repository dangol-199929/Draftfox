// Server-only: videos you made yourself, added to the Video Studio so they go through the same review, approve and
// Upload to YouTube steps as the generated ones. The browser sends the file in chunks of at most CHUNK_BYTES (the
// proxy keeps each request body in memory, up to 10 MB), and each chunk is appended to the file on disk. When the
// last one is in, FFprobe checks it and the file becomes the job's video.mp4: as it is (an MP4), repackaged (a MOV)
// or converted to 1080x1920 if you ask.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { db } from "./db.ts";
import { VIDEO_STAGES, getVideoJob, jobDir, logVideoEvent, type VideoJob, type VideoScript } from "./video-jobs.ts";

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
export const CHUNK_BYTES = 8 * 1024 * 1024;
export const UPLOAD_TYPES = ["mp4", "mov", "m4v"] as const;
export const CONVERT_MODES = ["none", "crop", "pad"] as const;
export type ConvertMode = (typeof CONVERT_MODES)[number];

const FFMPEG = process.env.FFMPEG?.trim() || "ffmpeg";
const FFPROBE = process.env.FFPROBE?.trim() || "ffprobe";

export type UploadInfo = { name: string; size: number; received: number; converting?: ConvertMode | null };

type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

function originalName(info: UploadInfo): string {
  return `original.${info.name.split(".").pop()!.toLowerCase()}`;
}

function uploadInfo(job: VideoJob): UploadInfo | null {
  return job.assets.source === "upload" ? ((job.assets.upload as UploadInfo | undefined) ?? null) : null;
}

function saveAssets(id: string, assets: Record<string, unknown>) {
  db().prepare("UPDATE video_jobs SET assets = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(assets), new Date().toISOString(), id);
}

// Makes the job for an upload. Nothing is in it until the chunks arrive.
export function createUploadJob(title: string, name: string, size: number): Result<{ job: VideoJob }> {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (!(UPLOAD_TYPES as readonly string[]).includes(extension)) return { ok: false, status: 400, error: "Upload an MP4 or MOV file." };
  if (!Number.isInteger(size) || size <= 0) return { ok: false, status: 400, error: "The file is empty." };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, status: 413, error: "Upload a file of up to 2 GB." };
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const script: VideoScript = { title, topic: title, narration: "", scenes: [], post_caption: "", hashtags: [], mood: "calm", style: "" };
  const assets = { source: "upload", madeWithAi: false, upload: { name: name.slice(0, 200), size, received: 0 } satisfies UploadInfo };
  db()
    .prepare(
      `INSERT INTO video_jobs (id, topic, status, stage, script, scenes, assets, created_at, updated_at)
       VALUES (?, ?, 'UPLOADING', NULL, ?, '[]', ?, ?, ?)`,
    )
    .run(id, title, JSON.stringify(script), JSON.stringify(assets), now, now);
  logVideoEvent(id, null, "info", `Uploading your video (${name}, ${(size / 1024 / 1024).toFixed(1)} MB)`);
  return { ok: true, job: getVideoJob(id)! };
}

// Appends one chunk, which must start where the file on disk ends (so a repeated or skipped chunk is refused).
export async function appendChunk(id: string, offset: number, body: ReadableStream<Uint8Array> | null): Promise<Result<{ received: number }>> {
  const job = getVideoJob(id);
  const info = job && uploadInfo(job);
  if (!job || !info) return { ok: false, status: 404, error: "No such upload." };
  if (job.status !== "UPLOADING" || info.converting) return { ok: false, status: 409, error: "This upload is already finished." };
  if (!body) return { ok: false, status: 400, error: "The chunk is empty." };
  const dir = jobDir(id);
  await mkdir(dir, { recursive: true });
  const path = join(dir, originalName(info));
  const have = (await stat(path).catch(() => null))?.size ?? 0;
  if (offset !== have) return { ok: false, status: 409, error: `Send the part starting at byte ${have}.` };

  let written = 0;
  const counted = Readable.fromWeb(body as import("node:stream/web").ReadableStream).on("data", (chunk: Buffer) => {
    written += chunk.length;
    if (written > CHUNK_BYTES || have + written > info.size) counted.destroy(new Error("The chunk is too big."));
  });
  try {
    await pipeline(counted, createWriteStream(path, { flags: "a" }));
  } catch (error) {
    return { ok: false, status: 400, error: (error as Error).message };
  }
  const received = have + written;
  saveAssets(id, { ...job.assets, upload: { ...info, received } });
  return { ok: true, received };
}

type Probe = { duration: number; width: number; height: number; videoCodec: string; audio: string | null };

function run(command: string, args: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (data) => (out += data));
    child.stderr.on("data", (data) => (err = (err + data).slice(-4000)));
    child.on("error", (error) => resolve({ code: -1, out, err: error.message }));
    child.on("close", (code) => resolve({ code: code ?? -1, out, err }));
  });
}

async function probe(dir: string, file: string): Promise<Probe | string> {
  const result = await run(FFPROBE, ["-v", "error", "-show_format", "-show_streams", "-of", "json", file], dir);
  if (result.code !== 0) return `FFprobe couldn't read the file: ${result.err.trim().slice(-300) || "is FFmpeg installed?"}`;
  const data = JSON.parse(result.out) as {
    format?: { duration?: string };
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[];
  };
  const video = data.streams?.find((s) => s.codec_type === "video");
  if (!video) return "That file has no video in it.";
  const audio = data.streams?.find((s) => s.codec_type === "audio");
  // Phones often store portrait video as landscape plus a 90 degree rotation.
  const rotation = Math.abs(Number(video.tags?.rotate ?? video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0)) % 180;
  const [width, height] = rotation === 90 ? [video.height ?? 0, video.width ?? 0] : [video.width ?? 0, video.height ?? 0];
  return { duration: Number(data.format?.duration ?? 0), width, height, videoCodec: video.codec_name ?? "?", audio: audio?.codec_name ?? null };
}

function warningsFor(info: Probe): string[] {
  const warnings: string[] = [];
  if (info.width !== 1080 || info.height !== 1920) {
    warnings.push(
      info.height > info.width
        ? `It's ${info.width}x${info.height}, not 1080x1920.`
        : `It's ${info.width}x${info.height}, not vertical; as a Short it would show with bars.`,
    );
  }
  if (info.duration > 60) warnings.push(`It's ${info.duration.toFixed(1)} s long; videos over 60 s may not count as Shorts.`);
  if (!info.audio) warnings.push("It has no sound.");
  if (info.videoCodec !== "h264" && info.videoCodec !== "hevc") warnings.push(`Its video codec is ${info.videoCodec}; browsers may not play it.`);
  return warnings;
}

const FIT: Record<Exclude<ConvertMode, "none">, string> = {
  crop: "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
  pad: "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black",
};

function fail(id: string, assets: Record<string, unknown>, error: string) {
  db()
    .prepare("UPDATE video_jobs SET status = 'FAILED', error = ?, assets = ?, updated_at = ? WHERE id = ?")
    .run(error.slice(0, 2000), JSON.stringify(assets), new Date().toISOString(), id);
  logVideoEvent(id, null, "error", error);
}

// Turns the uploaded file into video.mp4 and puts the job up for review. Runs after the request has answered: a
// conversion can take minutes. The job shows "Uploading" until then.
async function prepare(id: string, mode: ConvertMode) {
  const job = getVideoJob(id)!;
  const info = uploadInfo(job)!;
  const dir = jobDir(id);
  const source = originalName(info);
  const before = await probe(dir, source);
  if (typeof before === "string") return fail(id, { ...job.assets, upload: { ...info, converting: null } }, before);

  const out = "video.mp4";
  if (mode !== "none") {
    logVideoEvent(id, null, "info", `Converting to 1080x1920 (${mode === "crop" ? "cropped to fill" : "with bars"})`);
    const result = await run(
      FFMPEG,
      ["-y", "-hide_banner", "-nostdin", "-i", source, "-map", "0:v:0", "-map", "0:a:0?", "-vf", `${FIT[mode]},setsar=1`,
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart", out],
      dir,
    );
    if (result.code !== 0) return fail(id, { ...job.assets, upload: { ...info, converting: null } }, `The conversion failed: ${result.err.trim().slice(-400)}`);
  } else if (source.endsWith(".mp4")) {
    await rename(join(dir, source), join(dir, out));
  } else {
    // A MOV or M4V is repackaged as MP4 without re-encoding, so it plays in the browser and uploads as video/mp4.
    const result = await run(FFMPEG, ["-y", "-hide_banner", "-nostdin", "-i", source, "-map", "0", "-c", "copy", "-movflags", "+faststart", out], dir);
    if (result.code !== 0) {
      return fail(id, { ...job.assets, upload: { ...info, converting: null } }, `Couldn't repackage it as MP4; try again with "convert to 1080x1920". ${result.err.trim().slice(-300)}`);
    }
  }
  const after = await probe(dir, out);
  if (typeof after === "string") return fail(id, { ...job.assets, upload: { ...info, converting: null } }, after);
  await rm(join(dir, source), { force: true });
  const warnings = warningsFor(after);
  const qc = {
    duration: Math.round(after.duration * 100) / 100,
    resolution: `${after.width}x${after.height}`,
    codec: after.videoCodec,
    audio: after.audio,
    warnings,
    converted: mode === "none" ? null : mode,
    passed: true,
  };
  db()
    .prepare(
      `UPDATE video_jobs SET status = 'AWAITING_APPROVAL', progress = 1, error = NULL, output_path = ?, qc = ?, completed_stages = ?,
         assets = ?, updated_at = ? WHERE id = ?`,
    )
    .run(out, JSON.stringify(qc), JSON.stringify(VIDEO_STAGES), JSON.stringify({ ...job.assets, upload: { ...info, converting: null } }), new Date().toISOString(), id);
  logVideoEvent(id, null, warnings.length ? "warn" : "info", warnings.length ? `Ready for your review. Check: ${warnings.join(" ")}` : "Ready for your review");
}

// Called when the last chunk is in.
export function finishUpload(id: string, mode: ConvertMode): Result<{ job: VideoJob }> {
  const job = getVideoJob(id);
  const info = job && uploadInfo(job);
  if (!job || !info) return { ok: false, status: 404, error: "No such upload." };
  if (job.status !== "UPLOADING" || info.converting) return { ok: false, status: 409, error: "This upload is already finished." };
  if (info.received !== info.size) return { ok: false, status: 409, error: `Only ${info.received} of ${info.size} bytes arrived.` };
  saveAssets(id, { ...job.assets, upload: { ...info, converting: mode } });
  void prepare(id, mode).catch((error) => fail(id, job.assets, `Couldn't prepare the video: ${(error as Error).message}`));
  return { ok: true, job: getVideoJob(id)! };
}
