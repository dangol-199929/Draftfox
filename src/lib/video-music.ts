// Server-only: background music tracks, in data/videos/music/<mood>/ (the render stage picks one at random from the
// video's mood). Tracks you add from the Video Studio arrive in chunks like uploads (see video-uploads.ts).
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { VIDEO_DIR } from "./video-jobs.ts";
import { CHUNK_BYTES } from "./video-uploads.ts";
import { MUSIC_MOODS } from "./video-settings.ts";

const MUSIC_DIR = join(VIDEO_DIR, "music");
const TYPES = [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"];
const MAX_TRACK_BYTES = 100 * 1024 * 1024;

type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

// A safe file name for a track, or null when it isn't a music file.
function trackName(name: string): string | null {
  const clean = name.replace(/[^\w .()-]+/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
  return TYPES.some((type) => clean.toLowerCase().endsWith(type)) && !clean.startsWith(".") ? clean : null;
}

function moodDir(mood: string): string | null {
  return (MUSIC_MOODS as readonly string[]).includes(mood) ? join(MUSIC_DIR, mood) : null;
}

export async function listMusic(): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  for (const mood of MUSIC_MOODS) {
    const files = await readdir(join(MUSIC_DIR, mood)).catch(() => [] as string[]);
    result[mood] = files.filter((file) => TYPES.some((type) => file.toLowerCase().endsWith(type))).sort();
  }
  return result;
}

export async function appendMusicPart(mood: string, name: string, offset: number, body: ReadableStream<Uint8Array> | null): Promise<Result<{ received: number }>> {
  const dir = moodDir(mood);
  const file = trackName(name);
  if (!dir) return { ok: false, status: 400, error: "Pick a mood." };
  if (!file) return { ok: false, status: 400, error: "Use an MP3, WAV, M4A, AAC, OGG or FLAC file." };
  if (!body) return { ok: false, status: 400, error: "The chunk is empty." };
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${file}.part`);
  if (offset === 0) await rm(path, { force: true });
  const have = (await stat(path).catch(() => null))?.size ?? 0;
  if (offset !== have) return { ok: false, status: 409, error: `Send the part starting at byte ${have}.` };
  let written = 0;
  const counted = Readable.fromWeb(body as import("node:stream/web").ReadableStream).on("data", (chunk: Buffer) => {
    written += chunk.length;
    if (written > CHUNK_BYTES || have + written > MAX_TRACK_BYTES) counted.destroy(new Error("The track is too big (100 MB at most)."));
  });
  try {
    await pipeline(counted, createWriteStream(path, { flags: "a" }));
  } catch (error) {
    return { ok: false, status: 400, error: (error as Error).message };
  }
  return { ok: true, received: have + written };
}

export async function finishMusic(mood: string, name: string): Promise<Result<{ name: string }>> {
  const dir = moodDir(mood);
  const file = trackName(name);
  if (!dir || !file) return { ok: false, status: 400, error: "Pick a mood and a music file." };
  try {
    await rename(join(dir, `${file}.part`), join(dir, file));
  } catch {
    return { ok: false, status: 409, error: "The track didn't arrive." };
  }
  return { ok: true, name: file };
}

export async function deleteMusic(mood: string, name: string): Promise<Result<object>> {
  const dir = moodDir(mood);
  const file = trackName(name);
  if (!dir || !file) return { ok: false, status: 400, error: "Pick a track." };
  await rm(join(dir, file), { force: true });
  return { ok: true };
}
