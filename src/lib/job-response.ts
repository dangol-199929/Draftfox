// Server-only: the reply the job routes send back.
import { getJob } from "./db.ts";
import { keywordCheck, writingFor } from "./jobs.ts";
import { readProfile } from "./profile.ts";

// The job, the drafts being written for it, and which of the job's keywords your profile mentions.
export async function jobResponse(id: string): Promise<Response> {
  const job = getJob(id);
  if (!job) return Response.json({ error: "That job doesn't exist." }, { status: 404 });
  return Response.json({ job, writing: writingFor(id), keywords: keywordCheck(job, await readProfile()) });
}
