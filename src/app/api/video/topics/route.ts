import { badRequest, readJsonObject } from "@/lib/api.ts";
import { VIDEO_SERIES } from "@/lib/video-series.ts";
import { listVideoTopics, makeVideoFromTopic, nextTopicIdea } from "@/lib/video-topics.ts";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ topics: listVideoTopics(), series: VIDEO_SERIES.map(({ id, name }) => ({ id, name })) });
}

// { action: "next", series?, count? }: makes videos from the first ideas not made yet (count: 1 to 5, default 1).
// They join the queue, and the worker makes them one at a time.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (body?.action !== "next") return badRequest("Unknown action.");
  const series = typeof body.series === "string" ? body.series : undefined;
  const count = Math.min(Math.max(Math.round(Number(body.count) || 1), 1), 5);
  const jobs = [];
  const topics = [];
  for (let i = 0; i < count; i++) {
    const topic = nextTopicIdea(series);
    if (!topic) break;
    const result = makeVideoFromTopic(topic.id);
    if ("error" in result) return badRequest(result.error, result.status);
    jobs.push(result.job);
    topics.push(topic);
  }
  if (!jobs.length) return badRequest("Every idea already has a video.", 409);
  return Response.json({ job: jobs[0], topic: topics[0], jobs, topics }, { status: 201 });
}
