import { badRequest, readJsonObject } from "@/lib/api.ts";
import { appendScenePart, finishSceneMedia } from "@/lib/video-scene-media.ts";

export const runtime = "nodejs";
// Converting a long clip can take a minute.
export const maxDuration = 300;

type Params = { params: Promise<{ id: string; scene: string }> };

// Replacing scene <scene> (0-based) with your own picture or clip: PUT ?offset=<bytes so far> with each part of the
// file (up to 8 MB) as the raw body, then POST { name } (the file's name, for its type) when it's all in.
export async function PUT(request: Request, { params }: Params) {
  const { id, scene } = await params;
  const offset = Number(new URL(request.url).searchParams.get("offset"));
  if (!Number.isInteger(offset) || offset < 0) return badRequest("Give the offset.");
  const result = await appendScenePart(id, Number(scene), offset, request.body);
  if (!result.ok) return badRequest(result.error, result.status);
  return Response.json({ received: result.received });
}

export async function POST(request: Request, { params }: Params) {
  const { id, scene } = await params;
  const body = await readJsonObject(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return badRequest("Give the file's name.");
  const result = await finishSceneMedia(id, Number(scene), name);
  if (!result.ok) return badRequest(result.error, result.status);
  return Response.json({ job: result.job });
}
