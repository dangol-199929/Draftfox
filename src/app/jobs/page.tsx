import type { Metadata } from "next";
import { JobsBoard } from "@/components/jobs-board";
import { PageHeader } from "@/components/page-header";
import { QuickCopy } from "@/components/quick-copy";

export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { tab, job } = await searchParams;
  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Career"
        title="Jobs"
        description="Find roles that match your profile, see how each one fits, prepare a cover letter and answers, and track where you're up to. You always apply yourself."
      />
      <QuickCopy />
      <JobsBoard initialTab={tab === "find" ? "find" : "mine"} initialJob={typeof job === "string" ? job : null} />
    </div>
  );
}
