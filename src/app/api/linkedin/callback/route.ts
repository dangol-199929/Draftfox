import { NextResponse, type NextRequest } from "next/server";
import { STATE_COOKIE, connect, getConfig } from "@/lib/linkedin.ts";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const back = (query: string) => {
    const response = NextResponse.redirect(new URL(`/linkedin?${query}`, request.url));
    response.cookies.delete({ name: STATE_COOKIE, path: "/api/linkedin" });
    return response;
  };

  // LinkedIn reports problems (like a cancelled sign-in) as an error code; keep only safe characters.
  const linkedInError = params.get("error");
  if (linkedInError) {
    return back(`error=${linkedInError.replace(/[^a-z0-9_]/gi, "").slice(0, 64) || "unknown"}`);
  }

  const state = params.get("state");
  const expected = request.cookies.get(STATE_COOKIE)?.value;
  if (!state || !expected || state !== expected) return back("error=state_mismatch");

  const config = getConfig();
  if (!config) return back("error=not_configured");

  const code = params.get("code");
  if (!code) return back("error=token_exchange_failed");

  try {
    await connect(config, code);
  } catch (error) {
    console.error("LinkedIn sign-in failed:", (error as Error).message);
    return back("error=token_exchange_failed");
  }
  return back("connected=1");
}
