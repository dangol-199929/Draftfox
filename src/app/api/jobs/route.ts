import { randomUUID } from "node:crypto";
import { badRequest, readJsonObject } from "@/lib/api.ts";
import { insertJob, listJobs, logEvent, type JobRecord } from "@/lib/db.ts";
import { validateJobFields } from "@/lib/jobs.ts";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ jobs: listJobs() });
}

// Body: { title, company?, location?, url?, description?, notes? }. Saves the job and returns it.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body) return badRequest("Request body must be a JSON object.");
  const fields = validateJobFields(body, false);
  if (typeof fields === "string") return badRequest(fields);
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
    createdAt: now,
    updatedAt: now,
  };
  insertJob(job);
  logEvent("job_added");
  return Response.json({ job }, { status: 201 });
}
