import { badRequest, readJsonObject } from "@/lib/api.ts";
import { checkLink, importFromLink, importFromText } from "@/lib/job-import.ts";

export const runtime = "nodejs";

// Body: { input: a link to a job posting, or the posting's text }. Returns { job }: its title, company, location,
// link, description and salary, for you to check before saving. Nothing is saved here.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const input = typeof body?.input === "string" ? body.input.trim() : "";
  if (!input) return badRequest("Paste a link to the job, or the job's text.");
  if (input.length > 50_000) return badRequest("That's too long. Paste just the job's description.");

  const isLink = /^https?:\/\/\S+$/i.test(input);
  try {
    if (!isLink) return Response.json({ job: await importFromText(input) });
    const url = checkLink(input);
    if (typeof url === "string") return badRequest(url);
    return Response.json({ job: await importFromLink(url) });
  } catch (error) {
    const err = error as Error;
    const message =
      err.name === "TimeoutError"
        ? "The page took too long to answer. Paste the job's text instead."
        : err instanceof TypeError
          ? "Couldn't reach that page. Check the link and your internet connection, or paste the job's text instead."
          : err.message;
    return Response.json({ error: message }, { status: 502 });
  }
}
