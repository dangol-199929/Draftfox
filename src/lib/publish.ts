// Server-only: publishes a saved post (text and images) to LinkedIn and records the outcome.
// Used by the Post now button, by scheduled posts and by automatic posting.
import { getPost, logEvent, updatePost, type PostRecord, type PostStatus } from "./db.ts";
import { readImage } from "./images.ts";
import { LinkedInError, MAX_POST_LENGTH, createPost, deletePost, type PostImageUpload } from "./linkedin.ts";

export type PublishReason = "now" | "scheduled" | "autopilot";

// Publishes the post if it's still in `from` status (draft, scheduled or failed). Throws LinkedInError on failure,
// after saving the error on the post so it shows in the editor.
export async function publishPost(id: string, from: PostStatus, reason: PublishReason): Promise<PostRecord> {
  const post = getPost(id);
  if (!post) throw new LinkedInError(404, "That post no longer exists.");
  const problem = checkPost(post);
  if (problem) {
    updatePost(id, { status: "failed", error: problem }, from);
    throw new LinkedInError(400, problem);
  }
  // Claim it first, so a second click or the scheduler can't publish it twice.
  if (!updatePost(id, { status: "publishing", error: null }, from)) {
    throw new LinkedInError(409, "This post is already being published or was changed. Reload the page.");
  }

  try {
    const images: PostImageUpload[] = [];
    for (const image of post.images) {
      const file = await readImage(image.id);
      if (!file) throw new LinkedInError(400, "One of the images is missing. Remove it and try again.");
      images.push({ data: file.data, mime: file.record.mime, altText: image.alt });
    }
    const urn = await createPost({ text: post.text.trim(), visibility: post.visibility, images });
    const url = `https://www.linkedin.com/feed/update/${urn}`;
    const postedAt = new Date().toISOString();
    updatePost(id, { status: "posted", urn, url, postedAt, error: null });
    logEvent("post_published", {
      urn,
      url,
      visibility: post.visibility,
      characters: post.text.trim().length,
      images: post.images.length,
      reason,
      preview: post.text.trim().split("\n")[0].slice(0, 120),
    });
    return getPost(id)!;
  } catch (error) {
    const message =
      error instanceof LinkedInError ? error.message : "Couldn't reach LinkedIn. Check your internet connection and try again.";
    if (!(error instanceof LinkedInError)) console.error("Publishing failed:", (error as Error).message);
    updatePost(id, { status: "failed", error: message });
    logEvent("post_failed", { status: error instanceof LinkedInError ? error.status : 502, reason });
    throw error instanceof LinkedInError ? error : new LinkedInError(502, message);
  }
}

export async function unpublishPost(id: string): Promise<PostRecord> {
  const post = getPost(id);
  if (!post?.urn || post.status !== "posted") throw new LinkedInError(400, "This post isn't on LinkedIn.");
  await deletePost(post.urn);
  updatePost(id, { status: "deleted" });
  logEvent("post_deleted", { urn: post.urn });
  return getPost(id)!;
}

export function checkPost(post: PostRecord): string | null {
  const text = post.text.trim();
  if (!text && post.images.length === 0) return "The post is empty.";
  if (!text) return "Add some text to the post.";
  if (text.length > MAX_POST_LENGTH) {
    return `The post is ${text.length.toLocaleString("en")} characters; LinkedIn allows ${MAX_POST_LENGTH.toLocaleString("en")}.`;
  }
  return null;
}
