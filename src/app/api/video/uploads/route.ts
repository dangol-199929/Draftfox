import { badRequest, readJsonObject } from "@/lib/api.ts";
import { CHUNK_BYTES, createUploadJob } from "@/lib/video-uploads.ts";

export const runtime = "nodejs";

// { title, name, size }: starts an upload of a video you made. Then send the file in chunks to
// PUT /api/video/uploads/<id>?offset=<bytes so far>, and POST /api/video/uploads/<id> when they're all in.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const title = (typeof body?.title === "string" ? body.title.trim() : "").slice(0, 100) || name.replace(/\.[^.]+$/, "").slice(0, 100);
  if (!name) return badRequest("Pick a video file.");
  const result = createUploadJob(title || "My video", name, Number(body?.size));
  if (!result.ok) return badRequest(result.error, result.status);
  return Response.json({ job: result.job, chunkBytes: CHUNK_BYTES }, { status: 201 });
}
