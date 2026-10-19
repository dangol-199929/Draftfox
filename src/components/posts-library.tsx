"use client";

import { useState } from "react";
import { AutopilotPanel } from "@/components/autopilot-panel";
import { PostDrawer, usePostDrawer } from "@/components/post-drawer";
import { PostsCalendar } from "@/components/posts-calendar";
import { PostsList } from "@/components/posts-list";
import type { PostRecord } from "@/lib/db.ts";

// Every post, searchable, with the editor drawer.
export function PostsLibrary({ initialPost }: { initialPost: string | null }) {
  const drawer = usePostDrawer("/posts", initialPost);
  const [updated, setUpdated] = useState<PostRecord | null>(null);
  return (
    <>
      <PostsList onOpen={drawer.open} refreshKey={drawer.closedCount} updated={updated} activeId={drawer.openId} />
      <PostDrawer openId={drawer.openId} onClose={drawer.close} onOpen={drawer.open} onChange={setUpdated} />
    </>
  );
}

// Scheduled and published posts on a month calendar, with the editor drawer.
export function CalendarView({ initialPost }: { initialPost: string | null }) {
  const drawer = usePostDrawer("/calendar", initialPost);
  const [updated, setUpdated] = useState<PostRecord | null>(null);
  return (
    <>
      <PostsCalendar onOpen={drawer.open} refreshKey={drawer.closedCount} updated={updated} />
      <PostDrawer openId={drawer.openId} onClose={drawer.close} onOpen={drawer.open} onChange={setUpdated} />
    </>
  );
}

// Automatic posting settings; the posts it writes open in the editor drawer.
export function AutopilotView({ initialPost }: { initialPost: string | null }) {
  const drawer = usePostDrawer("/autopilot", initialPost);
  return (
    <>
      <AutopilotPanel onOpen={drawer.open} />
      <PostDrawer openId={drawer.openId} onClose={drawer.close} onOpen={drawer.open} />
    </>
  );
}
