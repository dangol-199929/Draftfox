import type { Metadata } from "next";
import { AutopilotPanel } from "@/components/autopilot-panel";
import { PageHeader } from "@/components/page-header";
import { PostsList } from "@/components/posts-list";

export const metadata: Metadata = { title: "Posts" };

export default function PostsPage() {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Posts"
        description="Edit posts with images, save drafts, post now or schedule them, and set up automatic posting."
      />
      <PostsList />
      <AutopilotPanel />
    </div>
  );
}
