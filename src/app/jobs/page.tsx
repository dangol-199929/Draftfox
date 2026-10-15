import type { Metadata } from "next";
import { JobsBoard } from "@/components/jobs-board";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { tab } = await searchParams;
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Jobs"
        description="Find jobs that match your profile or add one you found, see how each fits, draft a cover letter and answers, and track where you applied. You always apply yourself."
      />
      <JobsBoard initialTab={tab === "find" ? "find" : "mine"} />
    </div>
  );
}
