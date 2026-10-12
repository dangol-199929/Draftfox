import { logEvent } from "@/lib/db.ts";

export const runtime = "nodejs";

// Things only the browser knows about. Everything else is logged by the server route that did it.
const BROWSER_EVENTS = ["draft_copied"] as const;

// Body: { type, characters? }.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const { type, characters } = (body ?? {}) as { type?: unknown; characters?: unknown };
  if (!BROWSER_EVENTS.includes(type as (typeof BROWSER_EVENTS)[number])) {
    return Response.json({ error: `"type" must be one of: ${BROWSER_EVENTS.join(", ")}.` }, { status: 400 });
  }
  const length = typeof characters === "number" && Number.isFinite(characters) ? Math.max(0, Math.round(characters)) : undefined;
  logEvent(type as (typeof BROWSER_EVENTS)[number], length === undefined ? {} : { characters: length });
  return Response.json({ ok: true });
}
