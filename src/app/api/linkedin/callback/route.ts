import { NextResponse, type NextRequest } from "next/server";
import { STATE_COOKIE, connect, getConfig, type LoginMode } from "@/lib/linkedin.ts";

export const runtime = "nodejs";

const SCOPE_ERRORS = ["unauthorized_scope_error", "invalid_scope"];

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const back = (query: Record<string, string>) => {
    const response = NextResponse.redirect(new URL(`/linkedin?${new URLSearchParams(query)}`, request.url));
    response.cookies.delete({ name: STATE_COOKIE, path: "/api/linkedin" });
    return response;
  };

  const [cookieMode, expected] = (request.cookies.get(STATE_COOKIE)?.value ?? "").split(":");
  const mode: LoginMode = cookieMode === "posting" ? "posting" : "basic";

  // LinkedIn reports problems (like a cancelled sign-in) as an error code; keep only safe characters.
  // Nothing is saved on this path, so a refused posting upgrade leaves an existing connection untouched.
  const linkedInError = params.get("error");
  if (linkedInError) {
    const code = linkedInError.replace(/[^a-z0-9_]/gi, "").slice(0, 64) || "unknown";
    const detail = (params.get("error_description") ?? "").slice(0, 300);
    return back({
      error: mode === "posting" && SCOPE_ERRORS.includes(code) ? "posting_not_enabled" : code,
      ...(detail && { detail }),
    });
  }

  const state = params.get("state");
  if (!state || !expected || state !== expected) return back({ error: "state_mismatch" });

  const config = getConfig();
  if (!config) return back({ error: "not_configured" });

  const code = params.get("code");
  if (!code) return back({ error: "token_exchange_failed" });

  try {
    await connect(config, code, mode);
  } catch (error) {
    console.error("LinkedIn sign-in failed:", (error as Error).message);
    return back({ error: "token_exchange_failed" });
  }
  return back({ connected: "1" });
}
