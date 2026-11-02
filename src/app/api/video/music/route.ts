import { badRequest, readJsonObject } from "@/lib/api.ts";
import { appendMusicPart, deleteMusic, finishMusic, listMusic } from "@/lib/video-music.ts";

export const runtime = "nodejs";

const query = (request: Request) => new URL(request.url).searchParams;

export async function GET() {
  return Response.json({ music: await listMusic() });
}

// ?mood=&name=&offset=, with the next part of the track (up to 8 MB) as the raw body.
export async function PUT(request: Request) {
  const params = query(request);
  const offset = Number(params.get("offset"));
  if (!Number.isInteger(offset) || offset < 0) return badRequest("Give the offset.");
  const result = await appendMusicPart(params.get("mood") ?? "", params.get("name") ?? "", offset, request.body);
  if (!result.ok) return badRequest(result.error, result.status);
  return Response.json({ received: result.received });
}

// { mood, name }: the whole track is in.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const result = await finishMusic(String(body?.mood ?? ""), String(body?.name ?? ""));
  if (!result.ok) return badRequest(result.error, result.status);
  return Response.json({ name: result.name, music: await listMusic() });
}

// ?mood=&name=: removes a track from its mood folder.
export async function DELETE(request: Request) {
  const params = query(request);
  const result = await deleteMusic(params.get("mood") ?? "", params.get("name") ?? "");
  if (!result.ok) return badRequest(result.error, result.status);
  return Response.json({ music: await listMusic() });
}
