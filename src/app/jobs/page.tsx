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
        title="Jobs"
        description="Find jobs that match your profile or add one you found, see how each fits, draft a cover letter and answers, and track where you applied. You always apply yourself."
      />
      <QuickCopy />
      <JobsBoard initialTab={tab === "find" ? "find" : "mine"} initialJob={typeof job === "string" ? job : null} />
    </div>
  );
}
