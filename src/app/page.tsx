import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { WriteWorkspace } from "@/components/write-workspace";

// The layout's title template only applies to nested routes, so the home page spells its title out.
export const metadata: Metadata = { title: { absolute: "Write · Draftfox" } };

export default async function WritePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { post, tab } = await searchParams;
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Write"
        description="Write LinkedIn posts from your topic and experience, add images, and post or schedule them. Nothing is posted unless you choose to."
      />
      <WriteWorkspace
        initialPost={typeof post === "string" ? post : null}
        initialTab={tab === "schedule" ? "schedule" : "posts"}
      />
    </div>
  );
}
