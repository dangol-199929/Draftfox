import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { STATE_COOKIE, authorizeUrl, getConfig, type LoginMode } from "@/lib/linkedin.ts";

export const runtime = "nodejs";

// ?posting=1 also asks for permission to post; without it, sign-in only reads name, email and photo.
export async function GET(request: NextRequest) {
  const config = getConfig();
  if (!config) {
    return NextResponse.redirect(new URL("/profile?error=not_configured", request.url));
  }

  const mode: LoginMode = request.nextUrl.searchParams.get("posting") === "1" ? "posting" : "basic";
  // A random state ties LinkedIn's callback to this browser and blocks forged callbacks.
  // The cookie also remembers the mode, so the callback can explain a refused posting permission.
  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(authorizeUrl(config, state, mode));
  response.cookies.set(STATE_COOKIE, `${mode}:${state}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    maxAge: 600,
    path: "/api/linkedin",
  });
  return response;
}
