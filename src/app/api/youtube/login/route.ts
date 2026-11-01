import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { STATE_COOKIE, authorizeUrl, getConfig } from "@/lib/youtube.ts";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = getConfig();
  if (!config) {
    return NextResponse.redirect(new URL("/settings?youtube_error=not_configured#youtube", request.url));
  }

  // A random state ties Google's callback to this browser and blocks forged callbacks.
  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(authorizeUrl(config, state));
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    maxAge: 600,
    path: "/api/youtube",
  });
  return response;
}
