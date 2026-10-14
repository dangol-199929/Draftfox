import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { JobFinder } from "@/components/job-finder";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Find jobs" };

export default function FindJobsPage() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <Link href="/jobs" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> All jobs
        </Link>
        <PageHeader
          title="Find jobs"
          description="Search job boards with titles from your profile, ranked by how well each job matches your skills. Save the ones you like; you always apply yourself."
        />
      </div>
      <JobFinder />
    </div>
  );
}
