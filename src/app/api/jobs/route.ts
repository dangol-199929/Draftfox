import { randomUUID } from "node:crypto";
import { badRequest, readJsonObject } from "@/lib/api.ts";
import { insertJob, listJobs, logEvent, type JobRecord } from "@/lib/db.ts";
import { findDuplicate, validateJobFields } from "@/lib/jobs.ts";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ jobs: listJobs() });
}

// Body: { title, company?, location?, url?, description?, notes?, allowDuplicate? }. Saves the job and returns it.
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
    createdAt: now,
    updatedAt: now,
  };
  insertJob(job);
  logEvent("job_added");
  return Response.json({ job }, { status: 201 });
}
