// Small helpers shared by the API routes.
import { NextResponse } from "next/server";

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function badRequest(error: string, status = 400) {
  return Response.json({ error }, { status });
}

// A redirect with a relative Location, so the browser stays on the address it used (localhost, or the PC's network
// address from another computer). request.url can't be used for this: the server listens on 0.0.0.0, and that's
// what it would put in the redirect.
export function redirectTo(path: string, status = 303): NextResponse {
  return new NextResponse(null, { status, headers: { Location: path } });
}
