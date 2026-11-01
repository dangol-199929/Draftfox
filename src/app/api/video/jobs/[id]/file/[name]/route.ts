import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { badRequest } from "@/lib/api.ts";
import { getVideoJob, jobDir } from "@/lib/video-jobs.ts";

export const runtime = "nodejs";

const TYPES: Record<string, string> = {
  mp4: "video/mp4",
  png: "image/png",
  jpg: "image/jpeg",
  wav: "audio/wav",
  ass: "text/plain; charset=utf-8",
};

// One of a video's files (the MP4, a scene image, the narration...). Supports Range requests, so the player can
// seek; ?download=1 saves it under the video's title.
export async function GET(request: Request, { params }: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = await params;
  const job = getVideoJob(id);
  if (!job) return badRequest("No such video.", 404);
  if (!/^[\w-]+\.[a-z0-9]+$/i.test(name)) return badRequest("Bad file name.");
  const type = TYPES[name.split(".").pop()!.toLowerCase()];
  if (!type) return badRequest("That kind of file isn't served.");

  const path = join(jobDir(id), name);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return badRequest("That file isn't there (yet).", 404);

  const headers = new Headers({ "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-store" });
  if (new URL(request.url).searchParams.get("download") === "1") {
    const base = (job.script?.title ?? job.topic).replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "video";
    headers.set("Content-Disposition", `attachment; filename="${base}.${name.split(".").pop()}"`);
  }

  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : info.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : info.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, info.size - 1);
    if (start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`);
    headers.set("Content-Length", String(end - start + 1));
    const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers });
  }
  headers.set("Content-Length", String(info.size));
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { headers });
}
