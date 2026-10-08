import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { STATE_COOKIE, authorizeUrl, getConfig } from "@/lib/linkedin.ts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const config = getConfig();
  if (!config) {
    return NextResponse.redirect(new URL("/linkedin?error=not_configured", request.url));
  }

  // A random state ties LinkedIn's callback to this browser and blocks forged callbacks.
  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(authorizeUrl(config, state));
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    maxAge: 600,
    path: "/api/linkedin",
  });
  return response;
}
