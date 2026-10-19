"use client";

import { useCallback, useEffect, useState } from "react";
import { PostEditor, type PostStream } from "@/components/post-editor";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { PostRecord } from "@/lib/db.ts";

// The post open in the editor drawer, kept in the address as ?post=<id> so a reload or a shared link reopens it.
export function usePostDrawer(path: string, initialPost: string | null) {
  const [openId, setOpenId] = useState<string | null>(null);
  // Bumped when the drawer closes, so lists can load again and show what changed.
  const [closedCount, setClosedCount] = useState(0);

  const setUrl = useCallback(
    (postId: string | null) => {
      const params = new URLSearchParams(window.location.search);
      if (postId) params.set("post", postId);
      else params.delete("post");
      const query = params.toString();
      window.history.replaceState(null, "", query ? `${path}?${query}` : path);
    },
    [path],
  );

  const open = useCallback(
    (postId: string) => {
      setOpenId(postId);
      setUrl(postId);
    },
    [setUrl],
  );

  const close = useCallback(() => {
    setOpenId(null);
    setUrl(null);
    setClosedCount((count) => count + 1);
  }, [setUrl]);

  // Closes the drawer only if it still shows this post (it may have been switched meanwhile).
  const closeIf = useCallback(
    (postId: string) => {
      setOpenId((current) => {
        if (current !== postId) return current;
        setUrl(null);
        return null;
      });
    },
    [setUrl],
  );

  useEffect(() => {
    if (initialPost) open(initialPost);
  }, [initialPost, open]);

  return { openId, open, close, closeIf, closedCount };
}

// The post editor in a wide drawer on the right, over whichever page opened it.
export function PostDrawer({
  openId,
  onClose,
  onOpen,
  onChange,
  stream = null,
  onStop,
}: {
  openId: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
  onChange?: (post: PostRecord) => void;
  // Text the model is writing into the open post, from the Studio.
  stream?: (PostStream & { postId: string }) | null;
  onStop?: () => void;
}) {
  return (
    <Sheet open={openId !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-[min(76rem,96vw)]"
      >
        <SheetHeader className="sticky top-0 z-10 border-b bg-background/90 px-5 py-3.5 pr-14 backdrop-blur-md">
          <SheetTitle className="text-base font-semibold tracking-tight">Edit post</SheetTitle>
          <SheetDescription>Saved as you type. Nothing is posted unless you choose to.</SheetDescription>
        </SheetHeader>
        <div className="p-4 sm:p-5">
          {openId && (
            <PostEditor
              key={openId}
              id={openId}
              stream={stream?.postId === openId ? stream : null}
              onStop={onStop}
              onDeleted={onClose}
              onOpen={onOpen}
              onChange={onChange}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
