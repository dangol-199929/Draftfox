import { deleteState, isStateKey, readState, writeState } from "@/lib/db.ts";

export const runtime = "nodejs";

// Generous for a form plus a long post or a profile with 50 past posts.
const MAX_BYTES = 1_000_000;

export async function GET(_request: Request, ctx: RouteContext<"/api/state/[key]">) {
  const { key } = await ctx.params;
  if (!isStateKey(key)) return unknownKey(key);
  return Response.json({ value: readState(key) });
}

// Body: { value }. A null value clears the saved state.
export async function PUT(request: Request, ctx: RouteContext<"/api/state/[key]">) {
  const { key } = await ctx.params;
  if (!isStateKey(key)) return unknownKey(key);

  const text = await request.text();
  if (text.length > MAX_BYTES) return Response.json({ error: "State is too large to save." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || !("value" in body)) {
    return Response.json({ error: `Body must be {"value": ...}.` }, { status: 400 });
  }

  try {
    const { value } = body as { value: unknown };
    if (value === null) deleteState(key);
    else writeState(key, value);
  } catch (error) {
    console.error(`Could not save the ${key} page state:`, error);
    return Response.json({ error: `Could not save: ${(error as Error).message}` }, { status: 500 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/state/[key]">) {
  const { key } = await ctx.params;
  if (!isStateKey(key)) return unknownKey(key);
  deleteState(key);
  return Response.json({ ok: true });
}

function unknownKey(key: string) {
  return Response.json({ error: `Unknown page "${key}".` }, { status: 404 });
}
