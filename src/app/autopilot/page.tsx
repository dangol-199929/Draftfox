import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { AutopilotView } from "@/components/posts-library";

export const metadata: Metadata = { title: "Auto-posting" };

export default async function AutopilotPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { post } = await searchParams;
  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Create"
        title="Auto-posting"
        description="Let the app write a post from your topic list on a schedule, and either save it for you to approve or post it straight away."
      />
      <AutopilotView initialPost={typeof post === "string" ? post : null} />
    </div>
  );
}
