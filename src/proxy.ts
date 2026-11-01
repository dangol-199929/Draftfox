// Runs before every page and API request: everything needs a signed-in session except the login page itself,
// the login and logout API, and the worker API (which checks its own bearer token in each route).
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth.ts";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname) || pathname.startsWith("/api/worker/")) return NextResponse.next();
  if (isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return Response.json({ error: "Sign in to Draftfox first." }, { status: 401 });
  }
  // A relative redirect (see redirectTo in lib/api.ts): request.url has the server's 0.0.0.0 address.
  const login = new URL("/login", "http://draftfox");
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return new NextResponse(null, { status: 307, headers: { Location: `${login.pathname}${login.search}` } });
}

export const config = {
  // Static files and the app icons load without a session so the login page looks right.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png).*)"],
};
