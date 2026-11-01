import { logEvent } from "@/lib/db.ts";
import { NextResponse, type NextRequest } from "next/server";
import { STATE_COOKIE, connect, getConfig } from "@/lib/youtube.ts";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const back = (query: Record<string, string>) => {
    const response = NextResponse.redirect(new URL(`/settings?${new URLSearchParams(query)}#youtube`, request.url));
    response.cookies.delete({ name: STATE_COOKIE, path: "/api/youtube" });
    return response;
  };

  // Google reports problems (like a cancelled sign-in) as an error code; keep only safe characters.
  const googleError = params.get("error");
  if (googleError) {
    return back({ youtube_error: googleError.replace(/[^a-z0-9_]/gi, "").slice(0, 64) || "unknown" });
  }

  const state = params.get("state");
  const expected = request.cookies.get(STATE_COOKIE)?.value;
  if (!state || !expected || state !== expected) return back({ youtube_error: "state_mismatch" });

  const config = getConfig();
  if (!config) return back({ youtube_error: "not_configured" });

  const code = params.get("code");
  if (!code) return back({ youtube_error: "token_exchange_failed" });

  try {
    await connect(config, code);
    logEvent("youtube_connected");
  } catch (error) {
    console.error("YouTube sign-in failed:", (error as Error).message);
    return back({ youtube_error: "token_exchange_failed" });
  }
  return back({ youtube: "connected" });
}
