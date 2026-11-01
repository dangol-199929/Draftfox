// Server-only: the single-user password login. The password is stored as a scrypt hash in DRAFTFOX_PASSWORD_HASH
// and a session is a cookie holding its expiry time signed with AUTH_SECRET, so nothing is kept in the database.
// Imported by src/proxy.ts, so keep it free of database and other heavy imports.
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "draftfox_session";
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // seconds

// scrypt cost settings. The hash is written as scrypt:N:r:p:salt:key with base64url parts and no "$",
// because Next.js expands $NAME inside .env values.
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

function scryptKey(password: string, salt: Buffer, n: number, r: number, p: number, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, length, { N: n, r, p, maxmem: 256 * n * r }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptKey(password, salt, N, R, P, KEY_LENGTH);
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join(":");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, key] = stored.split(":");
  if (kind !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  try {
    const actual = await scryptKey(password, Buffer.from(salt, "base64url"), Number(n), Number(r), Number(p), expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export type AuthConfig = { passwordHash: string; secret: string };

// Both settings are needed; without them nobody can sign in (the login page explains how to set a password).
export function getAuthConfig(): AuthConfig | null {
  const passwordHash = process.env.DRAFTFOX_PASSWORD_HASH?.trim();
  const secret = process.env.AUTH_SECRET?.trim();
  return passwordHash && secret && secret.length >= 32 ? { passwordHash, secret } : null;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`draftfox-session:${payload}`).digest("base64url");
}

export function createSessionToken(secret: string, now = Date.now()): string {
  const expires = String(now + SESSION_MAX_AGE * 1000);
  return `${expires}.${sign(expires, secret)}`;
}

export function isValidSession(token: string | undefined, now = Date.now()): boolean {
  const config = getAuthConfig();
  if (!config || !token) return false;
  const [expires, signature] = token.split(".");
  if (!expires || !signature || !/^\d+$/.test(expires) || Number(expires) < now) return false;
  const expected = Buffer.from(sign(expires, config.secret));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function sessionCookie(token: string, secure: boolean) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    maxAge: SESSION_MAX_AGE,
    path: "/",
  };
}
