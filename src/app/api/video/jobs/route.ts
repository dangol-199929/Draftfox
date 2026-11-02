import { badRequest, readJsonObject } from "@/lib/api.ts";
import { createVideoJob, listVideoJobs, videoDefaults } from "@/lib/video-jobs.ts";
import { normalizeVideoSettings } from "@/lib/video-settings.ts";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ jobs: listVideoJobs() });
}

// { topic } or { topics: [...] }, with settings (video-settings.ts; your defaults fill in the rest): adds videos to
// the queue. motion: false still works and keeps the scenes still.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const raw = Array.isArray(body?.topics) ? body.topics : [body?.topic];
  const topics = raw
    .filter((topic): topic is string => typeof topic === "string")
    .map((topic) => topic.trim())
    .filter(Boolean);
  if (!topics.length) return badRequest("Write a topic for the video.");
  if (topics.some((topic) => topic.length > 500)) return badRequest("Keep each topic under 500 characters.");
  if (topics.length > 20) return badRequest("Add up to 20 topics at a time.");
  const seriesId = typeof body?.seriesId === "string" && body.seriesId.trim() ? body.seriesId.trim().slice(0, 100) : null;
  const settings = normalizeVideoSettings(body?.settings, videoDefaults());
  if (body?.motion === false) settings.motion = false;
  const jobs = topics.map((topic) => createVideoJob(topic, seriesId, settings));
  return Response.json({ jobs }, { status: 201 });
}
