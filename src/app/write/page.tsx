import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { WriteWorkspace } from "@/components/write-workspace";

export const metadata: Metadata = { title: "Studio" };

export default async function WritePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { post } = await searchParams;
  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow="Create"
        title="Studio"
        description="Turn a topic and what really happened into a LinkedIn post, then refine it, add images and post or schedule it. Nothing is posted unless you choose to."
      />
      <WriteWorkspace initialPost={typeof post === "string" ? post : null} />
    </div>
  );
}
