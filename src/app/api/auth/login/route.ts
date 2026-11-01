import { NextResponse, type NextRequest } from "next/server";
import { badRequest, readJsonObject } from "@/lib/api.ts";
import { createSessionToken, getAuthConfig, sessionCookie, verifyPassword } from "@/lib/auth.ts";

export const runtime = "nodejs";

// Wrong passwords per address, so guessing from another computer on the network stays slow.
const failures = new Map<string, { count: number; until: number }>();
const LOCK_AFTER = 5;
const LOCK_MS = 60_000;

function clientKey(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export async function POST(request: NextRequest) {
  const config = getAuthConfig();
  if (!config) {
    return badRequest("No password is set yet. On the computer running Draftfox, run: pnpm set-password", 503);
  }

  const key = clientKey(request);
  const record = failures.get(key);
  if (record && record.until > Date.now()) {
    return badRequest("Too many wrong passwords. Wait a minute and try again.", 429);
  }

  const body = await readJsonObject(request);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password || !(await verifyPassword(password, config.passwordHash))) {
    const count = (record?.count ?? 0) + 1;
    failures.set(key, { count, until: count >= LOCK_AFTER ? Date.now() + LOCK_MS : 0 });
    // A short pause makes each guess cost a second.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return badRequest("That password isn't right.", 401);
  }

  failures.delete(key);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie(createSessionToken(config.secret), request.nextUrl.protocol === "https:"));
  return response;
}
