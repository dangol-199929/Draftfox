import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { JobStatusBadge } from "@/components/job-badges";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { listJobs } from "@/lib/db.ts";
import { OFFER_LABELS, type OfferField } from "@/lib/job-status.ts";

export const metadata: Metadata = { title: "Compare offers" };

// Jobs with offer details (or at the offer stage), side by side, one column per job.
export default async function OffersPage() {
  // Reads the local database, so it must be fresh on every visit.
  await connection();
  const jobs = listJobs().filter((job) => job.offer || job.status === "offer");
  const fields = Object.keys(OFFER_LABELS) as OfferField[];

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <Link href="/jobs" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> All jobs
        </Link>
        <PageHeader title="Compare offers" description="The offer details you added to each job, side by side." />
      </div>
      <Card>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No offers yet. Open a job and use Add offer details, or move it to Offer.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="w-40" />
                    {jobs.map((job) => (
                      <th key={job.id} className="px-3 pb-3 text-left align-bottom font-medium">
                        <Link href={`/jobs/${job.id}`} className="underline-offset-4 hover:underline">
                          {job.title}
                        </Link>
                        <span className="block text-xs font-normal text-muted-foreground">{job.company}</span>
                        <span className="mt-1 block">
                          <JobStatusBadge status={job.status} />
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field) => (
                    <tr key={field} className="border-t">
                      <th scope="row" className="py-2 pr-3 text-left align-top text-xs font-normal text-muted-foreground">
                        {OFFER_LABELS[field].label}
                      </th>
                      {jobs.map((job) => (
                        <td key={job.id} className="px-3 py-2 align-top whitespace-pre-line">
                          {job.offer?.[field]?.trim() || <span className="text-muted-foreground">–</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
