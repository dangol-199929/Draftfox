import { badRequest, readJsonObject } from "@/lib/api.ts";
import { deleteJobRecord, getJob, logEvent, updateJob, type JobChanges } from "@/lib/db.ts";
import { jobResponse } from "@/lib/job-response.ts";
import { LIMITS, validateAnswerEdits, validateContacts, validateJobFields, validateOffer } from "@/lib/jobs.ts";

export const runtime = "nodejs";

export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return notFound();
  return jobResponse(id);
}

// Body: any of { title, company, location, url, description, notes, followUp (YYYY-MM-DD or null), status,
// letter (the edited cover letter text), answers ([{ question, answer }], edited answers), tailoredCv (edited text),
// email (edited text), contacts ([{ name, role, email, linkedin, notes }]), offer ({ salary, ... } or null) }.
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

  if (body.tailoredCv !== undefined) {
    if (typeof body.tailoredCv !== "string" || body.tailoredCv.length > LIMITS.letter) return badRequest("The CV is too long.");
    changes.tailoredCv = body.tailoredCv.trim() ? { text: body.tailoredCv, unverified: [], at: job.tailoredCv?.at ?? new Date().toISOString() } : null;
  }
  if (body.email !== undefined) {
    if (typeof body.email !== "string" || body.email.length > 5000) return badRequest("The email is too long.");
    changes.email = body.email.trim()
      ? { kind: job.email?.kind ?? "follow-up", text: body.email, unverified: [], at: job.email?.at ?? new Date().toISOString() }
      : null;
  }
  if (body.contacts !== undefined) {
    const contacts = validateContacts(body.contacts);
    if (typeof contacts === "string") return badRequest(contacts);
    changes.contacts = contacts;
  }
  if (body.offer !== undefined) {
    const offer = validateOffer(body.offer);
    if (typeof offer === "string") return badRequest(offer);
    changes.offer = offer;
  }

  updateJob(id, changes);
  if (changes.history) logEvent("job_status_changed", { status: fields.status });
  return jobResponse(id);
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
