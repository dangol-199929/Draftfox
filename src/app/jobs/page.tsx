import type { Metadata } from "next";
import { JobsBoard } from "@/components/jobs-board";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Jobs" };

export default function JobsPage() {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Jobs"
        description="Add a job you found, see how it fits your profile, draft a cover letter and answers, and track where you applied. You always apply yourself."
      />
      <JobsBoard />
    </div>
  );
}
