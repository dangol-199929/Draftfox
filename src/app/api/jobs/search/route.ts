import { badRequest, readJsonObject } from "@/lib/api.ts";
import { countryFromLocation, parseSearchInput } from "@/lib/job-links.ts";
import { adzunaConfigured, markNew, searchJobs, suggestSearches } from "@/lib/job-search.ts";
import { keywordScore } from "@/lib/job-status.ts";
import { hasProfileContent, keywordCheck, profileText } from "@/lib/jobs.ts";
import { readProfile } from "@/lib/profile.ts";

export const runtime = "nodejs";

// Suggested searches from your profile: job titles (from the model), and the country from your location.
export async function GET() {
  const profile = await readProfile();
  if (!hasProfileContent(profile)) {
    return Response.json({ searches: [], skills: [], country: "", fromModel: false, adzuna: adzunaConfigured(), profileEmpty: true });
  }
  const { searches, skills, fromModel } = await suggestSearches(profile, profileText(profile));
  return Response.json({ searches, skills, country: countryFromLocation(profile.location), fromModel, adzuna: adzunaConfigured(), profileEmpty: false });
}

// Body: { queries: string[] (1 to 3), country (a code from COUNTRIES, or "" for anywhere), place?, skills? (to rank
// by), remoteOnly?, postedWithin? ("1", "7" or "30" days), savedSearchId? }. Returns { results, sources }: postings (with keywords and a fit score) ranked by how well they match your profile, and how
// each job board did. With savedSearchId, results that search hasn't shown before are marked isNew.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body) return badRequest("Request body must be a JSON object.");
  const input = parseSearchInput(body);
  if (typeof input === "string") return badRequest(input);

  const profile = await readProfile();
  // Careerjet asks who is searching: your browser, and your address as this app sees it.
  const searcher = {
    ip: request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "127.0.0.1",
    userAgent: request.headers.get("user-agent") ?? "Draftfox",
  };
  const { results: found, sources } = await searchJobs(input, profile, searcher);
  // Which of each posting's keywords your profile mentions, for the list's fit score and the job's details.
  const results = found.map((job) => {
    const keywords = keywordCheck(job, profile);
    return { ...job, keywords, fit: keywordScore(keywords) };
  });
  if (results.length === 0 && sources.every((source) => source.error || source.skipped)) {
    return Response.json({ error: "Couldn't reach the job boards. Check your internet connection and try again.", sources }, { status: 503 });
  }
  const savedSearchId = typeof body.savedSearchId === "string" ? body.savedSearchId : "";
  return Response.json({ results: savedSearchId ? markNew(savedSearchId, results) : results, sources });
}
