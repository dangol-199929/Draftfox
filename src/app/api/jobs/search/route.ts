import { badRequest, readJsonObject } from "@/lib/api.ts";
import { COUNTRIES, countryFromLocation } from "@/lib/job-links.ts";
import { adzunaConfigured, MAX_QUERIES, MAX_SKILLS, searchJobs, suggestSearches } from "@/lib/job-search.ts";
import { hasProfileContent, profileText } from "@/lib/jobs.ts";
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

// Body: { queries: string[] (1 to 3), country (a code from COUNTRIES, or "" for anywhere), place?, skills? (to rank by) }.
// Returns { results, sources }: postings ranked by how well they match your profile, and how each job board did.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body) return badRequest("Request body must be a JSON object.");
  const queries = (Array.isArray(body.queries) ? body.queries : [])
    .map((query) => (typeof query === "string" ? query.trim() : ""))
    .filter(Boolean);
  if (queries.length === 0) return badRequest("Add a job title or keywords to search for.");
  if (queries.length > MAX_QUERIES || queries.some((query) => query.length > 100)) {
    return badRequest(`Search for at most ${MAX_QUERIES} things at once, each under 100 characters.`);
  }
  const country = typeof body.country === "string" ? body.country : "";
  if (country && !COUNTRIES.some((item) => item.code === country)) return badRequest("Unknown country.");
  const place = typeof body.place === "string" ? body.place.slice(0, 100) : "";
  const skills = (Array.isArray(body.skills) ? body.skills : [])
    .filter((skill): skill is string => typeof skill === "string" && skill.trim().length > 0 && skill.length <= 60)
    .slice(0, MAX_SKILLS);

  const { results, sources } = await searchJobs({ queries, country, place, skills }, await readProfile());
  if (results.length === 0 && sources.every((source) => source.error || source.skipped)) {
    return Response.json({ error: "Couldn't reach the job boards. Check your internet connection and try again.", sources }, { status: 503 });
  }
  return Response.json({ results, sources });
}
