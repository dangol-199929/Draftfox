import { badRequest, readJsonObject } from "@/lib/api.ts";
import { getJob, updateJob, type JobChanges } from "@/lib/db.ts";
import {
  answerQuestions,
  assessFit,
  hasProfileContent,
  isEmailKind,
  MAX_ANSWERS,
  prepareInterview,
  tailorCv,
  writeEmail,
  validateQuestions,
  whileWriting,
  writeLetter,
  WRITE_KINDS,
  type WriteKind,
} from "@/lib/jobs.ts";
import { readProfile } from "@/lib/profile.ts";
import { jobResponse } from "@/lib/job-response.ts";

export const runtime = "nodejs";

// Body: { kind: "fit" | "letter" | "answers" | "cv" | "interview" | "email", questions?: string[] (for answers),
// emailKind?: "follow-up" | "thank-you" (for email) }.
// Writes that draft from your profile, saves it on the job and returns the job.
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/generate">) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return Response.json({ error: "That job doesn't exist." }, { status: 404 });

  const body = await readJsonObject(request);
  const kind = body?.kind as WriteKind;
  if (!WRITE_KINDS.includes(kind)) return badRequest(`"kind" must be one of ${WRITE_KINDS.join(", ")}.`);
  const emailKind = body?.emailKind ?? "follow-up";
  if (kind === "email" && !isEmailKind(emailKind)) return badRequest(`"emailKind" must be follow-up or thank-you.`);
  const questions = kind === "answers" ? validateQuestions(body?.questions) : [];
  if (typeof questions === "string") return badRequest(questions);
  if (kind !== "answers" && kind !== "email" && !job.description.trim()) {
    return badRequest("Paste the job description first, so there's something to compare your profile with.");
  }

  const profile = await readProfile();
  if (!hasProfileContent(profile)) {
    return badRequest("Your profile is empty. Import your LinkedIn data or fill it in on the Profile page first.", 409);
  }

  try {
    const changes = await whileWriting<JobChanges>(id, kind, async () => {
      if (kind === "fit") return { fit: await assessFit(job, profile) };
      if (kind === "letter") {
        // The letter is written from the fit, so check the fit first if it hasn't been yet.
        const fit = job.fit ?? (await assessFit(job, profile));
        return { fit, letter: await writeLetter(job, profile, fit) };
      }
      if (kind === "cv") return { tailoredCv: await tailorCv(job, profile) };
      if (kind === "interview") return { interview: await prepareInterview(job, profile) };
      if (kind === "email") return { email: await writeEmail(job, profile, isEmailKind(emailKind) ? emailKind : "follow-up") };
      // New answers are added below the ones you have; asking the same question again replaces its answer.
      const answers = await answerQuestions(job, profile, questions, job.fit);
      const kept = job.answers.filter((answer) => !questions.includes(answer.question));
      return { answers: [...kept, ...answers].slice(-MAX_ANSWERS) };
    });
    if (!changes) return badRequest("This is already being written. It shows up here when it's done.", 409);
    // The job may have been deleted while the model was writing.
    if (!updateJob(id, changes)) return Response.json({ error: "That job doesn't exist anymore." }, { status: 404 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 503 });
  }
  return jobResponse(id);
}
