"use client";

import { useState } from "react";
import { Globe, MessageSquare, Repeat2, Send, ThumbsUp, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { PostImage } from "@/lib/db.ts";
import { cn } from "@/lib/utils";

// LinkedIn shows about three lines (roughly 210 characters on desktop) before "…see more".
const FOLD_LINES = 3;
const FOLD_CHARACTERS = 210;

// Where LinkedIn cuts the post off in the feed: after three lines or about 210 characters, whichever comes first.
export function foldIndex(text: string): number | null {
  let index = Math.min(text.length, FOLD_CHARACTERS);
  let lines = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n" && ++lines === FOLD_LINES) {
      index = Math.min(index, i);
      break;
    }
  }
  return index < text.trimEnd().length ? index : null;
}

export type PreviewAuthor = { name: string; headline: string; picture?: string };

// The post as it looks in the LinkedIn feed, folded at "…see more" until you expand it.
export function LinkedInPreview({
  text,
  images,
  author,
  visibility,
}: {
  text: string;
  images: PostImage[];
  author: PreviewAuthor;
  visibility: "PUBLIC" | "CONNECTIONS";
}) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = text.trim();
  const fold = foldIndex(trimmed);
  const shown = expanded || fold === null ? trimmed : trimmed.slice(0, fold).trimEnd();

  return (
    <div className="overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xs" aria-label="LinkedIn preview">
      <div className="flex items-start gap-2.5 px-3 pt-3">
        <Avatar className="size-10">
          {author.picture && <AvatarImage src={author.picture} alt="" />}
          <AvatarFallback className="bg-brand-soft text-xs">{initials(author.name) || "You"}</AvatarFallback>
        </Avatar>
        <div className="grid min-w-0 gap-0.5 leading-tight">
          <p className="truncate text-sm font-semibold">{author.name || "You"}</p>
          {author.headline && <p className="line-clamp-1 text-xs text-muted-foreground">{author.headline}</p>}
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            now ·{" "}
            {visibility === "PUBLIC" ? (
              <Globe className="size-3" aria-label="Anyone" />
            ) : (
              <Users className="size-3" aria-label="Connections" />
            )}
          </p>
        </div>
      </div>
      <div className="px-3 pt-2 pb-3 text-sm leading-relaxed break-words whitespace-pre-wrap">
        {trimmed ? (
          <>
            {shown}
            {fold !== null && !expanded && (
              <>
                …{" "}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground hover:underline"
                  onClick={() => setExpanded(true)}
                >
                  see more
                </button>
              </>
            )}
            {fold !== null && expanded && (
              <button
                type="button"
                className="mt-1 block text-xs text-muted-foreground hover:text-foreground hover:underline"
                onClick={() => setExpanded(false)}
              >
                show less
              </button>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">Your post will show here.</span>
        )}
      </div>
      {images.length > 0 && (
        <div className={cn("grid gap-0.5 bg-muted", images.length > 1 && "grid-cols-2")}>
          {images.slice(0, 4).map((image, index) => (
            <div key={image.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- local images served by the app */}
              <img
                src={`/api/images/${image.id}`}
                alt={image.alt}
                className={cn("w-full object-cover", images.length > 1 ? "aspect-square" : "max-h-96")}
              />
              {index === 3 && images.length > 4 && (
                <span className="absolute inset-0 grid place-items-center bg-black/50 text-lg font-semibold text-white">
                  +{images.length - 4}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-4 border-t text-xs text-muted-foreground" aria-hidden>
        {[
          [ThumbsUp, "Like"],
          [MessageSquare, "Comment"],
          [Repeat2, "Repost"],
          [Send, "Send"],
        ].map(([Icon, label]) => {
          const I = Icon as typeof ThumbsUp;
          return (
            <span key={label as string} className="flex items-center justify-center gap-1.5 py-2.5">
              <I className="size-3.5" />
              <span className="hidden sm:inline">{label as string}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
