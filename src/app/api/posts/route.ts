import { randomUUID } from "node:crypto";
import { badRequest, readJsonObject } from "@/lib/api.ts";
import { insertPost, listPosts, type PostRecord } from "@/lib/db.ts";
import { MAX_POST_LENGTH } from "@/lib/linkedin.ts";
import { startScheduler } from "@/lib/scheduler.ts";

export const runtime = "nodejs";

export async function GET() {
  // Normally started by instrumentation.ts; this covers a dev server that was running before it existed.
  startScheduler();
  return Response.json({ posts: listPosts() });
}

// Body: { text?, source? }. Creates a draft and returns it.
export async function POST(request: Request) {
  const body = (await readJsonObject(request)) ?? {};
  const text = typeof body.text === "string" ? body.text : "";
  if (text.length > MAX_POST_LENGTH * 2) return badRequest("The text is too long.");
  const now = new Date().toISOString();
  const post: PostRecord = {
    id: randomUUID(),
    text,
    images: [],
    visibility: "PUBLIC",
    status: "draft",
    source: body.source === "generate" ? "generate" : "editor",
    topic: typeof body.topic === "string" ? body.topic.slice(0, 500) : null,
    scheduledAt: null,
    postedAt: null,
    urn: null,
    url: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  insertPost(post);
  return Response.json({ post }, { status: 201 });
}
