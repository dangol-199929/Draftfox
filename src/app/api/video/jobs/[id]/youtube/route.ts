import { stat } from "node:fs/promises";
import { join } from "node:path";
import { badRequest, readJsonObject } from "@/lib/api.ts";
import { getVideoJob, jobDir, logVideoEvent } from "@/lib/video-jobs.ts";
import { failPublication, finishPublication, listPublications, saveUploadUrl, startPublication } from "@/lib/video-publications.ts";
import { PRIVACY_STATUSES, YouTubeError, uploadVideo, type PrivacyStatus } from "@/lib/youtube.ts";

export const runtime = "nodejs";
// Uploading a short video takes seconds to a minute.
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

// YouTube refuses titles and descriptions with angle brackets.
const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/[<>]/g, "").trim().slice(0, max) : "";

// YouTube allows 500 characters of tags in all; it counts a tag with a space as if it had quotes around it.
function tagsWithin(input: unknown): string[] {
  const tags: string[] = [];
  let total = 0;
  for (const raw of Array.isArray(input) ? input : []) {
    const tag = clean(raw, 100).replace(/^#/, "").replace(/,/g, "");
    if (!tag || tags.includes(tag)) continue;
    const cost = tag.length + (tag.includes(" ") ? 2 : 0) + (tags.length ? 1 : 0);
    if (total + cost > 500) break;
    tags.push(tag);
    total += cost;
  }
  return tags;
}

// Body: { title, description, tags: string[], privacy: "private" | "unlisted" | "public", madeWithAi?: boolean }.
// madeWithAi defaults to true for generated videos (AI images and voice) and false for your own uploads.
// Uploads the approved video's MP4 to the connected YouTube channel, once: a finished upload is never repeated.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const job = getVideoJob(id);
  if (!job) return badRequest("No such video.", 404);
  if (job.status !== "APPROVED") return badRequest("Approve the video before uploading it.", 409);
  if (!job.outputPath || !job.completedStages.includes("render")) return badRequest("This video hasn't been rendered.", 409);

  const body = await readJsonObject(request);
  const title = clean(body?.title, 100);
  if (!title) return badRequest("Give the video a title.");
  const privacy = body?.privacy;
  if (typeof privacy !== "string" || !(PRIVACY_STATUSES as readonly string[]).includes(privacy)) {
    return badRequest("Choose Private, Unlisted or Public.");
  }
  const details = {
    title,
    description: clean(body?.description, 5000),
    tags: tagsWithin(body?.tags),
    privacy: privacy as PrivacyStatus,
    madeWithAi: typeof body?.madeWithAi === "boolean" ? body.madeWithAi : job.assets.source !== "upload",
  };

  // The upload reads the file from disk chunk by chunk (youtube.ts), so only check it's there.
  const file = join(jobDir(id), job.outputPath);
  if (!(await stat(file).catch(() => null))?.isFile()) return badRequest("The video file is missing. Render it again.", 404);

  const start = startPublication(id, "youtube");
  if (!start.ok) {
    return start.reason === "uploaded"
      ? Response.json({ publications: listPublications(id) })
      : badRequest("This video is already being uploaded.", 409);
  }

  logVideoEvent(id, null, "info", `Uploading to YouTube (${details.privacy})`);
  try {
    const video = await uploadVideo(file, details, start.uploadUrl, (url) => saveUploadUrl(id, "youtube", url));
    finishPublication(id, "youtube", video.id, video.url);
    logVideoEvent(id, null, "info", `Uploaded to YouTube: ${video.url}`);
  } catch (error) {
    const message = (error as Error).message;
    failPublication(id, "youtube", message);
    logVideoEvent(id, null, "error", `YouTube upload failed: ${message}`);
    return Response.json(
      { error: message, publications: listPublications(id) },
      { status: error instanceof YouTubeError ? error.status : 500 },
    );
  }
  return Response.json({ publications: listPublications(id) });
}
