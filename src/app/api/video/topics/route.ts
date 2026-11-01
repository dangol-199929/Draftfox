import { badRequest, readJsonObject } from "@/lib/api.ts";
import { VIDEO_SERIES } from "@/lib/video-series.ts";
import { listVideoTopics, makeVideoFromTopic, nextTopicIdea } from "@/lib/video-topics.ts";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ topics: listVideoTopics(), series: VIDEO_SERIES.map(({ id, name }) => ({ id, name })) });
}

// { action: "next", series? }: makes a video from the first idea not made yet.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (body?.action !== "next") return badRequest("Unknown action.");
  const topic = nextTopicIdea(typeof body.series === "string" ? body.series : undefined);
  if (!topic) return badRequest("Every idea already has a video.", 409);
  const result = makeVideoFromTopic(topic.id);
  if ("error" in result) return badRequest(result.error, result.status);
  return Response.json({ job: result.job, topic }, { status: 201 });
}
