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

// Only go back to a page of this app after signing in, never to another site.
function safeNext(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

// A relative redirect, so the browser stays on the address it used (localhost here, or the PC's network address
// from another computer); the server's own idea of its URL can be localhost either way.
function goTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

// Takes JSON ({ password }) from the login page's script, or a plain form post (password, next) when the page's
// script didn't load. A form post gets redirects back instead of JSON.
export async function POST(request: NextRequest) {
  const isForm = !(request.headers.get("content-type") ?? "").includes("application/json");
  let password = "";
  let next = "/";
  if (isForm) {
    const form = await request.formData().catch(() => null);
    password = typeof form?.get("password") === "string" ? (form.get("password") as string) : "";
    next = safeNext(form?.get("next"));
  } else {
    const body = await readJsonObject(request);
    password = typeof body?.password === "string" ? body.password : "";
  }

  const fail = (error: string, status: number) => {
    if (!isForm) return badRequest(error, status);
    const query = new URLSearchParams({ error, ...(next !== "/" && { next }) });
    return goTo(`/login?${query}`);
  };

  const config = getAuthConfig();
  if (!config) return fail("No password is set yet. On the computer running Draftfox, run: pnpm set-password", 503);

  const key = clientKey(request);
  const record = failures.get(key);
  if (record && record.until > Date.now()) return fail("Too many wrong passwords. Wait a minute and try again.", 429);

  if (!password || !(await verifyPassword(password, config.passwordHash))) {
    const count = (record?.count ?? 0) + 1;
    failures.set(key, { count, until: count >= LOCK_AFTER ? Date.now() + LOCK_MS : 0 });
    // A short pause makes each guess cost a second.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return fail(password ? "That password isn't right." : "Enter your password.", 401);
  }

  failures.delete(key);
  const response = isForm ? goTo(next) : NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie(createSessionToken(config.secret), request.nextUrl.protocol === "https:"));
  return response;
}
