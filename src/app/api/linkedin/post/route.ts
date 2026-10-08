import { LinkedInError, MAX_POST_LENGTH, createPost, deletePost, type Visibility } from "@/lib/linkedin.ts";

export const runtime = "nodejs";

const VISIBILITIES: Visibility[] = ["PUBLIC", "CONNECTIONS"];

// Posts are only ever created from an explicit user action in the app's Post to LinkedIn dialog.
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body) return badRequest("Request body must be a JSON object.");

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return badRequest(`"text" is required.`);
  if (text.length > MAX_POST_LENGTH) {
    return badRequest(`"text" must be at most ${MAX_POST_LENGTH.toLocaleString("en")} characters.`);
  }
  const visibility = body.visibility ?? "PUBLIC";
  if (!VISIBILITIES.includes(visibility as Visibility)) {
    return badRequest(`"visibility" must be one of: ${VISIBILITIES.join(", ")}.`);
  }

  try {
    const urn = await createPost({ text, visibility: visibility as Visibility });
    return Response.json({ urn, url: `https://www.linkedin.com/feed/update/${urn}` });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  const body = await readJson(request);
  const urn = typeof body?.urn === "string" ? body.urn : "";
  if (!/^urn:li:(share|ugcPost):\d+$/.test(urn)) return badRequest(`"urn" must be a LinkedIn post URN.`);

  try {
    await deletePost(urn);
    return Response.json({ deleted: true });
  } catch (error) {
    return failure(error);
  }
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function badRequest(error: string) {
  return Response.json({ error }, { status: 400 });
}

function failure(error: unknown) {
  if (error instanceof LinkedInError) return Response.json({ error: error.message }, { status: error.status });
  console.error("LinkedIn request failed:", (error as Error).message);
  return Response.json({ error: "Couldn't reach LinkedIn. Check your internet connection and try again." }, { status: 502 });
}
