import { randomUUID } from "node:crypto";
import { badRequest, readJsonObject } from "@/lib/api.ts";
import { insertPost, type PostRecord } from "@/lib/db.ts";
import { hasProfileContent, profileText } from "@/lib/jobs.ts";
import { generateLinkedInPost } from "@/lib/post.ts";
import { readProfile } from "@/lib/profile.ts";

export const runtime = "nodejs";

// Body: { roles, preferences? }. Writes a LinkedIn post saying you're open to work, from your profile, and saves
// it as a draft on the Posts page. Nothing is posted: you review it there and post it yourself, or don't.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const roles = typeof body?.roles === "string" ? body.roles.trim().slice(0, 300) : "";
  const preferences = typeof body?.preferences === "string" ? body.preferences.trim().slice(0, 1000) : "";
  if (!roles) return badRequest("Say which roles you're looking for.");
  const profile = await readProfile();
  if (!hasProfileContent(profile)) {
    return badRequest("Your profile is empty. Import your LinkedIn data or add your CV on the Profile page first.", 409);
  }

  const experience = [
    `What I've done (my profile, the only facts to use):\n${profileText(profile).slice(0, 4000)}`,
    `Roles I'm looking for: ${roles}`,
    preferences && `What I'm looking for in my next role: ${preferences}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  let text: string;
  try {
    text = await generateLinkedInPost({
      topic: `I'm open to work and looking for a role as ${roles}`,
      experience,
      audience: "Recruiters, hiring managers and my network",
      tone: "Warm, confident and specific",
      length: "medium",
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 503 });
  }
  if (/^NEED MORE CONTEXT:/i.test(text)) return badRequest(text.replace(/^NEED MORE CONTEXT:\s*/i, "The model needs more to go on: "));

  const now = new Date().toISOString();
  const post: PostRecord = {
    id: randomUUID(),
    text,
    images: [],
    visibility: "PUBLIC",
    status: "draft",
    source: "generate",
    topic: `Open to work: ${roles}`.slice(0, 500),
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
