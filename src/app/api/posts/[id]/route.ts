import { badRequest, readJsonObject } from "@/lib/api.ts";
import { deletePostRecord, getImage, getPost, logEvent, updatePost, type PostRecord } from "@/lib/db.ts";
import { removeImageIfUnused } from "@/lib/images.ts";
import { MAX_POST_IMAGES, MAX_POST_LENGTH } from "@/lib/linkedin.ts";
import { checkPost } from "@/lib/publish.ts";

export const runtime = "nodejs";

// Posts that are on LinkedIn (or on their way) can't be edited here.
const LOCKED = ["publishing", "posted", "deleted"];

export async function GET(_request: Request, ctx: RouteContext<"/api/posts/[id]">) {
  const { id } = await ctx.params;
  const post = getPost(id);
  if (!post) return notFound();
  return Response.json({ post });
}

// Body: any of { text, images: [{ id, alt }], visibility, scheduledAt (ISO string, or null to unschedule) }.
// Setting scheduledAt schedules the post; null turns it back into a draft.
export async function PATCH(request: Request, ctx: RouteContext<"/api/posts/[id]">) {
  const { id } = await ctx.params;
  const post = getPost(id);
  if (!post) return notFound();
  if (LOCKED.includes(post.status)) return badRequest("This post is already on LinkedIn and can't be edited.", 409);

  const body = await readJsonObject(request);
  if (!body) return badRequest("Request body must be a JSON object.");
  const changes: Partial<PostRecord> = {};

  if (body.text !== undefined) {
    if (typeof body.text !== "string") return badRequest(`"text" must be a string.`);
    if (body.text.length > MAX_POST_LENGTH * 2) return badRequest("The text is too long.");
    changes.text = body.text;
  }
  if (body.images !== undefined) {
    if (!Array.isArray(body.images) || body.images.length > MAX_POST_IMAGES) {
      return badRequest(`"images" must be a list of at most ${MAX_POST_IMAGES} images.`);
    }
    const images: PostRecord["images"] = [];
    for (const item of body.images as unknown[]) {
      const image = item as { id?: unknown; alt?: unknown };
      if (typeof image?.id !== "string" || !getImage(image.id)) return badRequest("One of the images doesn't exist.");
      images.push({ id: image.id, alt: typeof image.alt === "string" ? image.alt.slice(0, 1000) : "" });
    }
    changes.images = images;
  }
  if (body.visibility !== undefined) {
    if (body.visibility !== "PUBLIC" && body.visibility !== "CONNECTIONS") {
      return badRequest(`"visibility" must be PUBLIC or CONNECTIONS.`);
    }
    changes.visibility = body.visibility;
  }
  if (body.scheduledAt !== undefined) {
    if (body.scheduledAt === null) {
      changes.scheduledAt = null;
      changes.status = "draft";
    } else {
      const when = typeof body.scheduledAt === "string" ? Date.parse(body.scheduledAt) : NaN;
      if (Number.isNaN(when)) return badRequest(`"scheduledAt" must be a date and time.`);
      if (when < Date.now() - 60_000) return badRequest("Pick a time in the future.");
      if (when > Date.now() + 366 * 86_400_000) return badRequest("Pick a time within the next year.");
      const problem = checkPost({ ...post, ...changes });
      if (problem) return badRequest(problem);
      changes.scheduledAt = new Date(when).toISOString();
      changes.status = "scheduled";
    }
    changes.error = null;
  } else if (post.status === "failed" && (changes.text !== undefined || changes.images !== undefined)) {
    // Editing a failed post makes it a draft again.
    changes.status = "draft";
  }

  // Images taken out of the post are deleted unless another post uses them.
  const removed = changes.images
    ? post.images.filter((image) => !changes.images!.some((kept) => kept.id === image.id))
    : [];
  if (!updatePost(id, changes, post.status)) return badRequest("The post changed meanwhile. Reload the page.", 409);
  for (const image of removed) await removeImageIfUnused(image.id);
  if (changes.status === "scheduled") logEvent("post_scheduled", { at: changes.scheduledAt });
  return Response.json({ post: getPost(id) });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/posts/[id]">) {
  const { id } = await ctx.params;
  const post = getPost(id);
  if (!post) return notFound();
  if (post.status === "publishing") return badRequest("This post is being published right now.", 409);
  deletePostRecord(id);
  for (const image of post.images) await removeImageIfUnused(image.id);
  return Response.json({ deleted: true });
}

function notFound() {
  return Response.json({ error: "That post doesn't exist." }, { status: 404 });
}
