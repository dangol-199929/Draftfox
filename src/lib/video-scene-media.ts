// Server-only: replacing one scene's picture or clip with your own file. It arrives in chunks, like a whole video
// (see video-uploads.ts), then FFmpeg turns it into what the pipeline uses: a picture becomes scene-<n>.png (and is
// animated like a drawn one, if motion is on); a clip becomes clip-<n>-own.mp4 at 1080x1920 without its sound (the
// narration plays over it), and its first frame becomes the scene's picture.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CHUNK_BYTES } from "./video-uploads.ts";
import { getVideoJob, jobDir, logVideoEvent, redoVideoStages, updateVideoJob, type VideoJob } from "./video-jobs.ts";

export const MAX_SCENE_BYTES = 500 * 1024 * 1024;
const IMAGE_TYPES = ["png", "jpg", "jpeg", "webp"];
const CLIP_TYPES = ["mp4", "mov", "m4v", "webm"];
// The longest own clip kept; a scene is rarely more than a few seconds.
const MAX_CLIP_SECONDS = 20;
const FFMPEG = process.env.FFMPEG?.trim() || "ffmpeg";

type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

const partName = (scene: number) => `scene-${scene + 1}-upload.part`;

function check(job: VideoJob | null, scene: number): string | null {
  if (!job) return "No such video.";
  if (job.assets.source === "upload") return "This is a video you uploaded; it has no scenes.";
  if (!Number.isInteger(scene) || scene < 0 || scene >= job.scenes.length) return "Pick a scene.";
  if (["GENERATING_SCRIPT", "GENERATING_VISUALS", "GENERATING_AUDIO", "RENDERING", "QUALITY_CHECK", "WAITING", "RETRYING"].includes(job.status)) {
    return "Wait for the worker to finish this video, or cancel it first.";
  }
  return null;
}

export async function appendScenePart(
  id: string,
  scene: number,
  offset: number,
  body: ReadableStream<Uint8Array> | null,
): Promise<Result<{ received: number }>> {
  const problem = check(getVideoJob(id), scene);
  if (problem) return { ok: false, status: 409, error: problem };
  if (!body) return { ok: false, status: 400, error: "The chunk is empty." };
  const dir = jobDir(id);
  await mkdir(dir, { recursive: true });
  const path = join(dir, partName(scene));
  // A new upload (offset 0) starts the file again.
  if (offset === 0) await rm(path, { force: true });
  const have = (await stat(path).catch(() => null))?.size ?? 0;
  if (offset !== have) return { ok: false, status: 409, error: `Send the part starting at byte ${have}.` };
  let written = 0;
  const counted = Readable.fromWeb(body as import("node:stream/web").ReadableStream).on("data", (chunk: Buffer) => {
    written += chunk.length;
    if (written > CHUNK_BYTES || have + written > MAX_SCENE_BYTES) counted.destroy(new Error("The file is too big (500 MB at most)."));
  });
  try {
    await pipeline(counted, createWriteStream(path, { flags: "a" }));
  } catch (error) {
    return { ok: false, status: 400, error: (error as Error).message };
  }
  return { ok: true, received: have + written };
}

function ffmpeg(args: string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(FFMPEG, ["-y", "-hide_banner", "-nostdin", "-loglevel", "error", ...args], { cwd, windowsHide: true });
    let err = "";
    child.stderr.on("data", (data) => (err = (err + data).slice(-2000)));
    child.on("error", (error) => resolve(error.message));
    child.on("close", (code) => resolve(code === 0 ? null : err.trim() || `FFmpeg exited with ${code}`));
  });
}

// The whole file is in: convert it, record it as the scene's own picture or clip, and queue what has to be made
// again (a picture's clip, or just the render).
export async function finishSceneMedia(id: string, scene: number, name: string): Promise<Result<{ job: VideoJob }>> {
  const job = getVideoJob(id);
  const problem = check(job, scene);
  if (problem || !job) return { ok: false, status: 409, error: problem ?? "No such video." };
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const kind = IMAGE_TYPES.includes(extension) ? "image" : CLIP_TYPES.includes(extension) ? "clip" : null;
  if (!kind) return { ok: false, status: 400, error: "Use a PNG, JPG or WebP picture, or an MP4, MOV or WebM clip." };
  const dir = jobDir(id);
  const part = partName(scene);
  if (!(await stat(join(dir, part)).catch(() => null))?.size) return { ok: false, status: 409, error: "The file didn't arrive." };

  const n = scene + 1;
  const picture = `scene-${n}.png`;
  // Pictures are fitted to the scene size the generator draws at, so the motion model gets the same shape.
  const fit = (w: number, h: number) => `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;
  let error: string | null;
  const own = `clip-${n}-own.mp4`;
  if (kind === "image") {
    error = await ffmpeg(["-i", part, "-frames:v", "1", "-vf", fit(768, 1344), "-update", "1", picture], dir);
  } else {
    error = await ffmpeg(
      ["-i", part, "-t", String(MAX_CLIP_SECONDS), "-an", "-vf", `${fit(1080, 1920)},fps=30`, "-c:v", "libx264", "-preset", "medium",
        "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", own],
      dir,
    );
    if (!error) error = await ffmpeg(["-i", own, "-frames:v", "1", "-vf", fit(768, 1344), "-update", "1", picture], dir);
  }
  await rm(join(dir, part), { force: true });
  if (error) return { ok: false, status: 400, error: `Couldn't use that file: ${error.slice(-300)}` };

  const files = { ...((job.assets.files as Record<string, string> | undefined) ?? {}), [`scene-${n}`]: picture };
  if (kind === "clip") files[`clip-${n}`] = own;
  const stills = ((job.assets.motion_stills as number[] | undefined) ?? []).filter((value) => value !== n);
  const scenes = job.scenes.map((item, index) =>
    index === scene ? { ...item, image: picture, image_source: "upload" as const, clip_source: kind === "clip" ? ("upload" as const) : null } : item,
  );
  updateVideoJob(id, {
    scenes,
    script: job.script ? { ...job.script, scenes } : undefined,
    assets: { ...job.assets, files, motion_stills: stills },
  });
  logVideoEvent(id, null, "info", `Scene ${n}: using your own ${kind === "image" ? "picture" : "clip"} (${name.slice(0, 80)})`);
  if (kind === "image") redoVideoStages(id, ["visuals"], { clips: [scene] }, `Animating your picture for scene ${n}`);
  else redoVideoStages(id, ["render"], null, `Rendering again with your clip in scene ${n}`);
  return { ok: true, job: getVideoJob(id)! };
}
