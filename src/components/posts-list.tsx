"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDownUp, Bot, CopyPlus, Images, Loader2, PenLine, Plus, Search, Sparkles } from "lucide-react";
import { formatWhen, StatusBadge } from "@/components/post-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PostRecord } from "@/lib/db.ts";
import { cn } from "@/lib/utils";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "scheduled", label: "Scheduled" },
  { value: "posted", label: "Posted" },
  { value: "failed", label: "Failed" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

const SORTS = [
  { value: "edited", label: "Recently edited" },
  { value: "created", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
] as const;
type Sort = (typeof SORTS)[number]["value"];

function matches(post: PostRecord, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "draft") return post.status === "draft";
  if (filter === "posted") return post.status === "posted" || post.status === "deleted";
  if (filter === "scheduled") return post.status === "scheduled" || post.status === "publishing";
  return post.status === filter;
}

function sortPosts(posts: PostRecord[], sort: Sort, filter: Filter) {
  const sorted = [...posts];
  // Scheduled posts read best soonest first, whatever the sort.
  if (filter === "scheduled") return sorted.sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
  if (sort === "edited") return sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (sort === "oldest") return sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Your posts. Opening one (or a new one) is up to the page, which shows it in the editor.
// With `limit`, a short "latest" list without the search and filters, as on the Studio.
export function PostsList({
  onOpen,
  refreshKey,
  updated,
  activeId,
  limit,
}: {
  onOpen: (id: string) => void;
  // Change it to load the list again.
  refreshKey: number;
  // The post open in the editor, as last saved, so the list shows changes without reloading.
  updated: PostRecord | null;
  activeId: string | null;
  limit?: number;
}) {
  const [posts, setPosts] = useState<PostRecord[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("edited");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState<"" | "new" | string>("");
  const compact = limit !== undefined;

  useEffect(() => {
    fetch("/api/posts")
      .then((response) => response.json() as Promise<{ posts: PostRecord[] }>)
      .then(({ posts }) => setPosts(posts))
      .catch(() => setError("Couldn't load your posts. Is the app still running?"));
  }, [refreshKey]);

  useEffect(() => {
    if (!updated) return;
    setPosts((current) =>
      current && current.some((post) => post.id === updated.id)
        ? current.map((post) => (post.id === updated.id ? updated : post))
        : current && [updated, ...current],
    );
  }, [updated]);

  // A new empty post, or a copy of an existing one's text.
  async function create(from?: PostRecord) {
    setCreating(from ? from.id : "new");
    try {
      const response = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(from ? { text: from.text } : {}),
      });
      if (!response.ok) throw new Error();
      const { post } = (await response.json()) as { post: PostRecord };
      setPosts((current) => current && [post, ...current]);
      onOpen(post.id);
    } catch {
      setError(from ? "Couldn't copy that post." : "Couldn't create a post.");
    } finally {
      setCreating("");
    }
  }

  const needle = query.trim().toLowerCase();
  const filtered = (posts ?? []).filter(
    (post) => matches(post, filter) && (!needle || post.text.toLowerCase().includes(needle) || post.topic?.toLowerCase().includes(needle)),
  );
  const shown = compact ? sortPosts(posts ?? [], "edited", "all").slice(0, limit) : sortPosts(filtered, sort, filter);

  return (
    <div className="grid gap-3">
      {!compact && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Search posts"
              placeholder="Search your posts"
              className="pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <label className="relative flex items-center">
            <span className="sr-only">Sort</span>
            <ArrowDownUp className="pointer-events-none absolute left-3 size-3.5 text-muted-foreground" />
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              disabled={filter === "scheduled"}
              className="h-9 appearance-none rounded-lg border border-input bg-field py-1 pr-8 pl-8 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {filter === "scheduled" ? "Soonest first" : option.label}
                </option>
              ))}
            </select>
          </label>
          <Button disabled={creating !== ""} onClick={() => create()}>
            {creating === "new" ? <Loader2 className="animate-spin" /> : <Plus />}
            Write my own
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border bg-card shadow-card">
        {!compact && (
          <div className="flex gap-1 overflow-x-auto border-b px-2 py-1.5" role="tablist" aria-label="Show">
            {FILTERS.map((option) => {
              const count = (posts ?? []).filter((post) => matches(post, option.value)).length;
              if (option.value === "failed" && count === 0) return null;
              return (
                <button
                  key={option.value}
                  role="tab"
                  aria-selected={filter === option.value}
                  onClick={() => setFilter(option.value)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    filter === option.value && "bg-muted font-medium text-foreground",
                    option.value === "failed" && "text-destructive hover:text-destructive",
                  )}
                >
                  {option.label}
                  {posts && (
                    <span
                      className={cn(
                        "rounded px-1 text-xs tabular-nums",
                        filter === option.value ? "bg-card text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {error && <p className="px-4 py-3 text-sm text-destructive">{error}</p>}
        {!posts && !error && (
          <ul className="grid gap-4 p-4" aria-label="Loading posts">
            {[0, 1, 2].map((index) => (
              <li key={index} className="flex items-center gap-3">
                <span className="skeleton size-12 rounded-md" />
                <span className="grid flex-1 gap-2">
                  <span className="skeleton h-3 w-3/4 rounded" />
                  <span className="skeleton h-2.5 w-1/3 rounded" />
                </span>
              </li>
            ))}
          </ul>
        )}
        {posts && shown.length === 0 && (
          <EmptyPosts
            first={posts.length === 0}
            filter={filter}
            searching={needle !== ""}
            creating={creating === "new"}
            onCreate={() => create()}
          />
        )}
        {shown.length > 0 && (
          <ul className="grid divide-y">
            {shown.map((post) => (
              <li key={post.id} className="group/row relative">
                <button
                  type="button"
                  onClick={() => onOpen(post.id)}
                  aria-current={post.id === activeId ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
                    post.id === activeId && "bg-brand-soft/50",
                    !compact && "pr-14",
                  )}
                >
                  {post.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local images served by the app
                    <img
                      src={`/api/images/${post.images[0].id}`}
                      alt=""
                      className="size-12 shrink-0 rounded-md border bg-muted object-cover"
                    />
                  ) : (
                    <span className="grid size-12 shrink-0 place-items-center rounded-md border bg-surface" aria-hidden>
                      {post.source === "generate" ? (
                        <Sparkles className="size-4 text-brand/70" />
                      ) : post.source === "autopilot" ? (
                        <Bot className="size-4 text-muted-foreground" />
                      ) : (
                        <PenLine className="size-4 text-muted-foreground" />
                      )}
                    </span>
                  )}
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className={cn("truncate text-sm font-medium", !post.text.trim() && "font-normal text-muted-foreground")}>
                      {post.text.trim().split("\n")[0] || "Empty draft"}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
                      <span className={cn(post.status === "failed" && "text-destructive")}>{describe(post)}</span>
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
                </button>
                {!compact && post.text.trim() && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Duplicate into a new draft"
                    title="Duplicate into a new draft"
                    className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground opacity-100 sm:opacity-0 sm:group-hover/row:opacity-100 sm:focus-visible:opacity-100"
                    disabled={creating !== ""}
                    onClick={() => create(post)}
                  >
                    {creating === post.id ? <Loader2 className="animate-spin" /> : <CopyPlus />}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EmptyPosts({
  first,
  filter,
  searching,
  creating,
  onCreate,
}: {
  first: boolean;
  filter: Filter;
  searching: boolean;
  creating: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="grid justify-items-center gap-3 px-4 py-12 text-center">
      <span className="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand-strong">
        <PenLine className="size-5" />
      </span>
      <div className="grid gap-1">
        <p className="text-sm font-semibold">
          {first ? "Your first post starts here" : searching ? "No posts match that search" : "Nothing here yet"}
        </p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {first
            ? "Give the AI a topic in the Studio, or write your own. Drafts are saved as you type."
            : searching
              ? "Try a different word, or clear the search."
              : filter === "scheduled"
                ? "Pick a time in a draft's Publish panel and it shows up here and on the calendar."
                : "Try another filter."}
        </p>
      </div>
      {first && (
        <div className="flex flex-wrap justify-center gap-2 pt-1">
          <Button asChild>
            <Link href="/write">
              <Sparkles />
              Write with AI
            </Link>
          </Button>
          <Button variant="outline" disabled={creating} onClick={onCreate}>
            {creating ? <Loader2 className="animate-spin" /> : <Plus />}
            Write my own
          </Button>
        </div>
      )}
    </div>
  );
}

export function describe(post: PostRecord) {
  switch (post.status) {
    case "scheduled":
      return `Goes out ${formatWhen(post.scheduledAt!)}`;
    case "posted":
      return `Posted ${formatWhen(post.postedAt!)}`;
    case "publishing":
      return "Posting now…";
    case "deleted":
      return "Deleted from LinkedIn";
    case "failed":
      return post.error ?? "Didn't go out";
    default:
      return `Edited ${formatWhen(post.updatedAt)}`;
  }
}
