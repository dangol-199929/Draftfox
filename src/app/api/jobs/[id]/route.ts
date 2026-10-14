import { badRequest, readJsonObject } from "@/lib/api.ts";
import { deleteJobRecord, getJob, logEvent, updateJob, type JobChanges } from "@/lib/db.ts";
import { LIMITS, validateAnswerEdits, validateJobFields, writingFor } from "@/lib/jobs.ts";

export const runtime = "nodejs";

export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return notFound();
  return Response.json({ job, writing: writingFor(id) });
}

// Body: any of { title, company, location, url, description, notes, followUp (YYYY-MM-DD or null), status,
// letter (the edited cover letter text), answers ([{ question, answer }], edited answers) }.
export async function PATCH(request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return notFound();
  const body = await readJsonObject(request);
  if (!body) return badRequest("Request body must be a JSON object.");

  const fields = validateJobFields(body, true);
  if (typeof fields === "string") return badRequest(fields);
  const changes: JobChanges = { ...fields };

  if (fields.status && fields.status !== job.status) {
    changes.history = [...job.history, { status: fields.status, at: new Date().toISOString() }];
  }
  if (body.letter !== undefined) {
    if (typeof body.letter !== "string" || body.letter.length > LIMITS.letter) return badRequest("The letter is too long.");
    // Your own edits replace the draft; the gaps the model listed stay until you write a new draft.
    changes.letter = body.letter.trim()
      ? { text: body.letter, gaps: job.letter?.gaps ?? [], unverified: [], at: job.letter?.at ?? new Date().toISOString() }
      : null;
  }
  if (body.answers !== undefined) {
    const answers = validateAnswerEdits(body.answers, job.answers);
    if (typeof answers === "string") return badRequest(answers);
    changes.answers = answers;
  }

  updateJob(id, changes);
  if (changes.history) logEvent("job_status_changed", { status: fields.status });
  return Response.json({ job: getJob(id), writing: writingFor(id) });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  if (!getJob(id)) return notFound();
  deleteJobRecord(id);
  return Response.json({ deleted: true });
}

function notFound() {
  return Response.json({ error: "That job doesn't exist." }, { status: 404 });
}
