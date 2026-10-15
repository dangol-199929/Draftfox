import { randomUUID } from "node:crypto";
import { badRequest, readJsonObject } from "@/lib/api.ts";
import { insertJob, listJobs, logEvent, type JobRecord } from "@/lib/db.ts";
import { findDuplicate, keywordCheck, validateJobFields } from "@/lib/jobs.ts";
import { keywordScore } from "@/lib/job-status.ts";
import { readProfile } from "@/lib/profile.ts";

export const runtime = "nodejs";

// The jobs, and for each one how many of its keywords your profile mentions (0 to 100, or null without keywords).
export async function GET() {
  const jobs = listJobs();
  const profile = await readProfile();
  const scores = Object.fromEntries(jobs.map((job) => [job.id, keywordScore(keywordCheck(job, profile))]));
  return Response.json({ jobs, scores });
}

// Body: { title, company?, location?, url?, description?, notes?, source?, salary?, postedAt?, allowDuplicate? }. Saves the job and returns it.
// A job with the same link, or the same title at the same company, is refused with 409 and the existing job's id,
// unless allowDuplicate is true.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body) return badRequest("Request body must be a JSON object.");
  const fields = validateJobFields(body, false);
  if (typeof fields === "string") return badRequest(fields);
  if (body.allowDuplicate !== true) {
    const duplicate = findDuplicate(listJobs(), fields);
    if (duplicate) {
      return Response.json(
        { error: `You already saved this job (${duplicate.status}).`, duplicateId: duplicate.id },
        { status: 409 },
      );
    }
  }
  const now = new Date().toISOString();
  const job: JobRecord = {
    id: randomUUID(),
    title: fields.title ?? "",
    company: fields.company ?? "",
    location: fields.location ?? "",
    url: fields.url ?? "",
    description: fields.description ?? "",
    status: "saved",
    notes: fields.notes ?? "",
    followUp: null,
    history: [{ status: "saved", at: now }],
    fit: null,
    letter: null,
    answers: [],
    tailoredCv: null,
    interview: null,
    email: null,
    contacts: [],
    offer: null,
    source: typeof body.source === "string" ? body.source.slice(0, 50) : "",
    salary: typeof body.salary === "string" ? body.salary.slice(0, 200) : "",
    postedAt: typeof body.postedAt === "string" && !Number.isNaN(Date.parse(body.postedAt)) ? body.postedAt : null,
    createdAt: now,
    updatedAt: now,
  };
  insertJob(job);
  logEvent("job_added");
  return Response.json({ job }, { status: 201 });
}
