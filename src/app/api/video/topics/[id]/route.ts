import { badRequest } from "@/lib/api.ts";
import { makeVideoFromTopic } from "@/lib/video-topics.ts";

export const runtime = "nodejs";

// Makes a video from this idea.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = makeVideoFromTopic(Number(id));
  if ("error" in result) return badRequest(result.error, result.status);
  return Response.json({ job: result.job }, { status: 201 });
}
