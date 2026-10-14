import { listJobs } from "@/lib/db.ts";
import { jobsCsv } from "@/lib/jobs.ts";

export const runtime = "nodejs";

// Your tracker as a CSV file (opens in Excel, Numbers or Google Sheets).
export async function GET() {
  const date = new Date().toISOString().slice(0, 10);
  return new Response(jobsCsv(listJobs()), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="draftfox-jobs-${date}.csv"`,
    },
  });
}
