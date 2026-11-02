import { badRequest, readJsonObject } from "@/lib/api.ts";
import { CONVERT_MODES, appendChunk, finishUpload, type ConvertMode } from "@/lib/video-uploads.ts";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// ?offset=<bytes already sent>, with the next part of the file (up to 8 MB) as the raw body.
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const offset = Number(new URL(request.url).searchParams.get("offset"));
  if (!Number.isInteger(offset) || offset < 0) return badRequest("Give the offset.");
  const result = await appendChunk(id, offset, request.body);
  if (!result.ok) return badRequest(result.error, result.status);
  return Response.json({ received: result.received });
}

// { convert: "none" | "crop" | "pad" }: the whole file is in; check it and put it up for review.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await readJsonObject(request);
  const mode = (CONVERT_MODES as readonly string[]).includes(body?.convert as string) ? (body?.convert as ConvertMode) : "none";
  const result = finishUpload(id, mode);
  if (!result.ok) return badRequest(result.error, result.status);
  return Response.json({ job: result.job });
}
