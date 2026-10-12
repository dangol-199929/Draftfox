import { getPost } from "@/lib/db.ts";
import { LinkedInError } from "@/lib/linkedin.ts";
import { publishPost, unpublishPost } from "@/lib/publish.ts";

export const runtime = "nodejs";

// Publishes the post now. Only ever called from an explicit click on Post in the editor's confirmation dialog.
export async function POST(_request: Request, ctx: RouteContext<"/api/posts/[id]/publish">) {
  const { id } = await ctx.params;
  const post = getPost(id);
  if (!post) return Response.json({ error: "That post doesn't exist." }, { status: 404 });
  if (!["draft", "scheduled", "failed"].includes(post.status)) {
    return Response.json({ error: "This post is already on LinkedIn." }, { status: 409 });
  }
  try {
    return Response.json({ post: await publishPost(id, post.status, "now") });
  } catch (error) {
    return failure(error);
  }
}

// Deletes the published post from LinkedIn; the copy here stays, marked as deleted.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/posts/[id]/publish">) {
  const { id } = await ctx.params;
  try {
    return Response.json({ post: await unpublishPost(id) });
  } catch (error) {
    return failure(error);
  }
}

function failure(error: unknown) {
  if (error instanceof LinkedInError) return Response.json({ error: error.message }, { status: error.status });
  console.error("LinkedIn request failed:", (error as Error).message);
  return Response.json({ error: "Couldn't reach LinkedIn. Check your internet connection and try again." }, { status: 502 });
}
