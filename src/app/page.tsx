import type { Metadata } from "next";
import { AutopilotPanel } from "@/components/autopilot-panel";
import { GenerateForm } from "@/components/generate-form";
import { PageHeader } from "@/components/page-header";
import { PostsList } from "@/components/posts-list";

// The layout's title template only applies to nested routes, so the home page spells its title out.
export const metadata: Metadata = { title: { absolute: "Write · Draftfox" } };

export default function WritePage() {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Write"
        description="Write a LinkedIn post from your topic and experience, then edit, add images and post or schedule it. Nothing is posted unless you choose to."
      />
      <GenerateForm />
      <PostsList />
      <AutopilotPanel />
    </div>
  );
}
