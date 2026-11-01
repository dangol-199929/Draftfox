// Server-only: the Video Studio worker signs its requests with "Authorization: Bearer <WORKER_TOKEN>" (from .env),
// because it has no browser session. The proxy lets /api/worker/* through; every route there calls this first.
import { timingSafeEqual } from "node:crypto";
import { readJsonObject } from "./api.ts";

export function workerAuthError(request: Request): Response | null {
  const token = process.env.WORKER_TOKEN?.trim();
  if (!token || token.length < 32) {
    return Response.json({ error: "WORKER_TOKEN isn't set in .env." }, { status: 503 });
  }
  const header = request.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7).trim() : "");
  const expected = Buffer.from(token);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: "Wrong or missing worker token." }, { status: 401 });
  }
  return null;
}

// The request body plus the worker's id, which every worker call includes.
export async function readWorkerBody(request: Request): Promise<{ body: Record<string, unknown>; workerId: string } | null> {
  const body = await readJsonObject(request);
  const workerId = typeof body?.workerId === "string" ? body.workerId.trim().slice(0, 100) : "";
  return body && workerId ? { body, workerId } : null;
}
