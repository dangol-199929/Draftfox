import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth.ts";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete({ name: SESSION_COOKIE, path: "/" });
  return response;
}
