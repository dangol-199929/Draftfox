"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Images, Loader2, Plus } from "lucide-react";
import { formatWhen, StatusBadge } from "@/components/post-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import type { PostRecord } from "@/lib/db.ts";
import { cn } from "@/lib/utils";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "scheduled", label: "Scheduled" },
  { value: "posted", label: "Posted" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

// Failed posts sit with drafts: both need you to do something.
function matches(post: PostRecord, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "draft") return post.status === "draft" || post.status === "failed";
  if (filter === "posted") return post.status === "posted" || post.status === "deleted";
  return post.status === filter;
}

export function PostsList() {
  const router = useRouter();
  const [posts, setPosts] = useState<PostRecord[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/posts")
      .then((response) => response.json() as Promise<{ posts: PostRecord[] }>)
      .then(({ posts }) => setPosts(posts))
      .catch(() => setError("Couldn't load your posts."));
  }, []);

  async function create() {
    setCreating(true);
    try {
      const response = await fetch("/api/posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const { post } = (await response.json()) as { post: PostRecord };
      router.push(`/posts/${post.id}`);
    } catch {
      setError("Couldn't create a post.");
      setCreating(false);
    }
  }

  // Newest first, as the server sends them; scheduled posts soonest first.
  const shown = (posts ?? []).filter((post) => matches(post, filter));
  if (filter === "scheduled") shown.sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your posts</CardTitle>
        <CardAction>
          <Button size="sm" disabled={creating} onClick={create}>
            {creating ? <Loader2 className="animate-spin" /> : <Plus />}
            New post
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Show">
          {FILTERS.map((option) => {
            const count = (posts ?? []).filter((post) => matches(post, option.value)).length;
            return (
              <button
                key={option.value}
                role="tab"
                aria-selected={filter === option.value}
                onClick={() => setFilter(option.value)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  filter === option.value && "bg-muted text-foreground",
                )}
              >
                {option.label}
                {posts && <span className="ml-1 tabular-nums text-muted-foreground">{count}</span>}
              </button>
            );
          })}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {!posts && !error && (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </p>
        )}
        {posts && shown.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {posts.length === 0
              ? "No posts yet. Start one here, or open a generated post in the editor from the Generate page."
              : "Nothing here."}
          </p>
        )}
        {shown.length > 0 && (
          <ul className="grid divide-y">
            {shown.map((post) => (
              <li key={post.id}>
                <Link
                  href={`/posts/${post.id}`}
                  className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted/60"
                >
                  {post.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local images served by the app
                    <img
                      src={`/api/images/${post.images[0].id}`}
                      alt=""
                      className="size-12 shrink-0 rounded-md bg-muted object-cover"
                    />
                  ) : (
                    <span className="size-12 shrink-0 rounded-md bg-muted" aria-hidden />
                  )}
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className={cn("truncate text-sm", !post.text.trim() && "text-muted-foreground")}>
                      {post.text.trim().split("\n")[0] || "Empty draft"}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>{describe(post)}</span>
                      {post.images.length > 1 && (
                        <span className="inline-flex items-center gap-1">
                          <Images className="size-3" /> {post.images.length}
                        </span>
                      )}
                      {post.source === "autopilot" && (
                        <span className="inline-flex items-center gap-1">
                          <Bot className="size-3" /> Automatic
                        </span>
                      )}
                    </span>
                  </span>
                  <StatusBadge post={post} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function describe(post: PostRecord) {
  switch (post.status) {
    case "scheduled":
      return `Goes out ${formatWhen(post.scheduledAt!)}`;
    case "posted":
      return `Posted ${formatWhen(post.postedAt!)}`;
    case "failed":
      return post.error ?? "Didn't go out";
    default:
      return `Edited ${formatWhen(post.updatedAt)}`;
  }
}
