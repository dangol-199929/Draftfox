// Server-only: finds job postings for the Jobs page through job boards' public APIs, and ranks them against your
// profile. Only the search words (and country) are sent; your profile never leaves this computer.
// - Himalayas (himalayas.app) and Jobicy (jobicy.com): remote jobs, no key needed.
// - Adzuna (adzuna.com): jobs in many countries, with a free API key in ADZUNA_APP_ID and ADZUNA_APP_KEY.
// The boards ask that results credit them and link to the original posting, which the page does.
// LinkedIn has no job search API for personal apps, so LinkedIn, Seek and Indeed are offered as links instead.
import { randomUUID } from "node:crypto";
import { readSetting, writeSetting } from "./db.ts";
import { findCountry, MAX_QUERIES, MAX_SKILLS, type SearchInput, type SourceName } from "./job-links.ts";

export { MAX_QUERIES, MAX_SKILLS, type SearchInput };
import { generateJson } from "./ollama.ts";
import type { Profile } from "./profile.ts";

const MAX_RESULTS = 40;
const DESCRIPTION_LENGTH = 6000;
const TIMEOUT = 15_000;

export type FoundJob = {
  // Source and the board's own id, so the same posting isn't listed twice.
  id: string;
  source: SourceName;
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
  postedAt: string | null;
  salary: string | null;
  // Profile words found in the posting, best first.
  matched: string[];
  score: number;
  // With a saved search: true when this search hadn't shown the job before.
  isNew?: boolean;
};

export type SourceResult = { name: SourceName; count: number; error?: string; skipped?: string };

type Found = Omit<FoundJob, "matched" | "score">;

// --- Sources ---

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { Accept: "application/json" } });
  if (response.status === 429) throw new Error("too many searches; try again in a minute");
  if (!response.ok) throw new Error(`returned ${response.status}`);
  return (await response.json()) as T;
}

type HimalayasJob = {
  guid: string;
  title: string;
  companyName: string;
  applicationLink: string;
  description: string;
  excerpt?: string;
  pubDate?: number;
  minSalary?: number | null;
  maxSalary?: number | null;
  currency?: string;
  locationRestrictions?: string[];
};

async function himalayas(query: string, countryName: string): Promise<Found[]> {
  const params = new URLSearchParams({ q: query });
  if (countryName) params.set("country", countryName);
  const data = await getJson<{ jobs?: HimalayasJob[] }>(`https://himalayas.app/jobs/api/search?${params}`);
  return (data.jobs ?? []).map((job) => ({
    id: `himalayas:${job.guid}`,
    source: "Himalayas",
    title: job.title,
    company: job.companyName,
    location: remoteLocation(job.locationRestrictions ?? []),
    url: job.applicationLink || job.guid,
    description: htmlToText(job.description || job.excerpt || ""),
    postedAt: job.pubDate ? new Date(job.pubDate * 1000).toISOString() : null,
    salary: salaryText(job.minSalary, job.maxSalary, job.currency),
  }));
}

type JobicyJob = {
  id: number;
  url: string;
  jobTitle: string;
  companyName: string;
  jobGeo?: string;
  jobDescription?: string;
  jobExcerpt?: string;
  pubDate?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
};

async function jobicy(query: string, countryName: string): Promise<Found[]> {
  const params = new URLSearchParams({ count: "30", tag: query });
  const data = await getJson<{ jobs?: JobicyJob[] }>(`https://jobicy.com/api/v2/remote-jobs?${params}`);
  // Jobicy can't filter by country, so keep the jobs open to it or to anywhere.
  const geoOk = (geo: string) =>
    !countryName || /anywhere|worldwide|global/i.test(geo) || geo.toLowerCase().includes(countryName.toLowerCase());
  return (data.jobs ?? [])
    .filter((job) => geoOk(job.jobGeo ?? ""))
    .map((job) => ({
      id: `jobicy:${job.id}`,
      source: "Jobicy",
      title: decodeEntities(job.jobTitle),
      company: decodeEntities(job.companyName),
      location: job.jobGeo ? `Remote (${job.jobGeo})` : "Remote",
      url: job.url,
      description: htmlToText(job.jobDescription || job.jobExcerpt || ""),
      postedAt: job.pubDate ? new Date(job.pubDate).toISOString() : null,
      salary: salaryText(job.salaryMin, job.salaryMax, job.salaryCurrency),
    }));
}

type AdzunaJob = {
  id: string;
  title: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  redirect_url: string;
  description?: string;
  created?: string;
  salary_min?: number;
  salary_max?: number;
};

export function adzunaConfigured(): boolean {
  return Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY);
}

async function adzuna(query: string, countryCode: string, place: string): Promise<Found[]> {
  const params = new URLSearchParams({
    app_id: process.env.ADZUNA_APP_ID ?? "",
    app_key: process.env.ADZUNA_APP_KEY ?? "",
    what: query,
    results_per_page: "30",
    "content-type": "application/json",
  });
  if (place) params.set("where", place);
  const data = await getJson<{ results?: AdzunaJob[] }>(`https://api.adzuna.com/v1/api/jobs/${countryCode}/search/1?${params}`);
  return (data.results ?? []).map((job) => ({
    id: `adzuna:${job.id}`,
    source: "Adzuna",
    title: htmlToText(job.title),
    company: job.company?.display_name ?? "",
    location: job.location?.display_name ?? "",
    url: job.redirect_url,
    // Adzuna gives a short snippet; the full posting is on the job's page.
    description: htmlToText(job.description ?? ""),
    postedAt: job.created ?? null,
    salary: salaryText(job.salary_min, job.salary_max, ""),
  }));
}

// --- Search ---


// Runs each search on each source at once. A source that fails is reported, not fatal.
export async function searchJobs(input: SearchInput, profile: Profile | null): Promise<{ results: FoundJob[]; sources: SourceResult[] }> {
  const country = findCountry(input.country);
  const queries = input.queries.slice(0, MAX_QUERIES);
  const runners: { name: SourceName; skipped?: string; run: (query: string) => Promise<Found[]> }[] = [
    { name: "Himalayas", run: (query) => himalayas(query, country?.name ?? "") },
    { name: "Jobicy", run: (query) => jobicy(query, country?.name ?? "") },
    {
      name: "Adzuna",
      skipped: !adzunaConfigured() ? "add a free Adzuna API key to search local jobs" : !country ? "pick a country to search local jobs" : undefined,
      run: (query) => adzuna(query, country!.code, input.place.trim()),
    },
  ];

  const sources: SourceResult[] = [];
  const found: Found[] = [];
  await Promise.all(
    runners.map(async (runner) => {
      if (runner.skipped) {
        sources.push({ name: runner.name, count: 0, skipped: runner.skipped });
        return;
      }
      const settled = await Promise.allSettled(queries.map((query) => runner.run(query)));
      const jobs = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
      const failure = settled.find((result) => result.status === "rejected");
      const error = failure && jobs.length === 0 ? sourceError(failure.reason) : undefined;
      sources.push({ name: runner.name, count: jobs.length, ...(error ? { error } : {}) });
      found.push(...jobs);
    }),
  );
  sources.sort((a, b) => runners.findIndex((r) => r.name === a.name) - runners.findIndex((r) => r.name === b.name));

  return { results: rank(dedupe(found), profile, queries, input.skills), sources };
}

function sourceError(reason: unknown): string {
  const error = reason as Error;
  if (error?.name === "TimeoutError") return "didn't answer in time";
  if (error instanceof TypeError) return "couldn't be reached; check your internet connection";
  return error?.message ?? "failed";
}

// The same posting found by two searches, or on two boards, is listed once.
function dedupe(jobs: Found[]): Found[] {
  const seen = new Set<string>();
  return jobs.filter((job) => {
    const key = `${job.title}|${job.company}`.toLowerCase().replace(/[^a-z0-9|]/g, "");
    if (seen.has(job.id) || seen.has(key)) return false;
    seen.add(job.id);
    seen.add(key);
    return true;
  });
}

// --- Ranking against the profile ---

const STOPWORDS = new Set(
  ("a an and at for in of on or the to with by from as is are be i my me we our you your senior junior lead mid level " +
    "intern internship developer engineer software specialist associate remote").split(" "),
);

// Words and phrases from the profile to look for in postings: skills, job titles and the searches themselves.
export function profileTerms(profile: Profile | null, queries: string[], skills: string[] = []): string[] {
  const terms = new Set<string>();
  const add = (term: string) => {
    // "Cascading Style Sheets (CSS)" is looked for as both "cascading style sheets" and "css".
    const parts = withoutBrackets(term);
    for (const part of parts) {
      const clean = part.trim().toLowerCase();
      if (clean.length > 1 && !STOPWORDS.has(clean)) terms.add(clean);
    }
  };
  for (const query of queries) {
    add(query);
    query.split(/\s+/).forEach(add);
  }
  skills.forEach(add);
  if (profile) {
    profile.skills.forEach(add);
    for (const position of profile.positions.slice(0, 4)) position.title.split(/[\s,/|&()-]+/).forEach(add);
    profile.headline.split(/[|,/•·]+/).forEach(add);
  }
  return [...terms];
}

function rank(jobs: Found[], profile: Profile | null, queries: string[], extraSkills: string[]): FoundJob[] {
  const allSkills = [...(profile?.skills ?? []), ...extraSkills];
  const skills = new Set(allSkills.map((skill) => skill.toLowerCase()));
  const terms = profileTerms(profile, queries, extraSkills).map((term) => ({ term, pattern: wordPattern(term) }));
  const names = displayNames(profile, queries, extraSkills);
  return jobs
    .map((job) => {
      const title = job.title.toLowerCase();
      const body = job.description.toLowerCase();
      const hits: { term: string; weight: number }[] = [];
      for (const { term, pattern } of terms) {
        const inTitle = pattern.test(title);
        const inBody = pattern.test(body);
        if (!inTitle && !inBody) continue;
        // A word in the title says the most about the job; a skill of yours in the description counts more
        // than another word from your titles.
        hits.push({ term, weight: (inTitle ? 3 : 0) + (inBody ? (skills.has(term) ? 2 : 1) : 0) });
      }
      // Spellings of the same thing ("React", "React.js"; "Next.js", "nextjs") count once, shown the way your
      // skills write it.
      const byKey = new Map<string, { term: string; weight: number }>();
      for (const hit of hits) {
        const key = termKey(hit.term);
        const best = byKey.get(key);
        if (!best) byKey.set(key, hit);
        else byKey.set(key, { term: skills.has(best.term) ? best.term : hit.term, weight: Math.max(best.weight, hit.weight) });
      }
      const unique = [...byKey.values()];
      // "react" inside a matched "react developer" isn't counted twice.
      const matched = unique
        .filter((hit) => !unique.some((other) => other.term !== hit.term && other.term.split(" ").includes(hit.term)))
        .sort((a, b) => b.weight - a.weight);
      const score = matched.reduce((total, hit) => total + hit.weight, 0);
      return {
        ...job,
        description: job.description.slice(0, DESCRIPTION_LENGTH),
        score,
        matched: matched.slice(0, 6).map((hit) => names.get(termKey(hit.term)) ?? hit.term),
      };
    })
    .filter((job) => job.score > 0)
    .sort((a, b) => b.score - a.score || (b.postedAt ?? "").localeCompare(a.postedAt ?? ""))
    .slice(0, MAX_RESULTS);
}

// "React.js", "ReactJS" and "react" share the key "react".
function termKey(term: string): string {
  return term.toLowerCase().replace(/[^a-z0-9+#]/g, "").replace(/(.)js$/, "$1");
}

function wordPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}(?![a-z0-9+#])`);
}

// "Cascading Style Sheets (CSS)" -> ["Cascading Style Sheets", "CSS"].
function withoutBrackets(text: string): string[] {
  return [text.replace(/\([^)]*\)/g, ""), ...[...text.matchAll(/\(([^)]*)\)/g)].map((match) => match[1])].map((part) => part.trim());
}

// How each matched term is shown: the way your skills write it first, then your searches, headline and titles.
function displayNames(profile: Profile | null, queries: string[], skills: string[]): Map<string, string> {
  const names = new Map<string, string>();
  const sources = [
    ...[...(profile?.skills ?? []), ...skills].flatMap(withoutBrackets),
    ...queries.flatMap((query) => [query, ...query.split(/\s+/)]),
    ...(profile?.headline.split(/[|,/•·]+/) ?? []),
    ...(profile?.positions.slice(0, 4).flatMap((position) => position.title.split(/[\s,/|&()-]+/)) ?? []),
  ];
  for (const source of sources) {
    const name = source.trim();
    const key = termKey(name);
    if (name && key && !names.has(key)) names.set(key, name);
  }
  return names;
}

// --- Search suggestions ---

const SUGGEST_SYSTEM = `You suggest job searches for the person in the PROFILE.
Rules:
- searches: 3 job titles they could apply for now, based only on their roles, skills and level in the PROFILE. Each 1 to 4 words, like "Frontend Developer" or "React Developer".
- Don't suggest roles that need experience the PROFILE doesn't show.
- No company names, no locations, no seniority words unless the PROFILE clearly shows that level.
- skills: up to 15 skills, tools or technologies that are written in the PROFILE, copied exactly as written. Never add ones that aren't there.`;

const SUGGEST_SCHEMA = {
  type: "object",
  properties: {
    searches: { type: "array", items: { type: "string" }, minItems: 1, maxItems: MAX_QUERIES },
    skills: { type: "array", items: { type: "string" }, maxItems: MAX_SKILLS },
  },
  required: ["searches", "skills"],
};

// Job titles to search for, and skills to rank results by (taken from a pasted CV, say, when the profile has no
// skills list). From the model, or from the profile's own titles and skills when the model isn't available.
export async function suggestSearches(
  profile: Profile,
  profileText: string,
): Promise<{ searches: string[]; skills: string[]; fromModel: boolean }> {
  const own = profile.skills.slice(0, MAX_SKILLS);
  try {
    const reply = await generateJson<{ searches?: unknown; skills?: unknown }>(`PROFILE\n${profileText}`, SUGGEST_SYSTEM, SUGGEST_SCHEMA);
    const clean = (list: unknown, max: number) =>
      (Array.isArray(list) ? list : []).map((item) => String(item).replace(/["“”]/g, "").trim()).filter((item) => item && item.length <= max);
    const searches = clean(reply.searches, 60).slice(0, MAX_QUERIES);
    // Only skills that really are in the profile text.
    const lower = profileText.toLowerCase();
    const found = clean(reply.skills, 60).filter((skill) => lower.includes(skill.toLowerCase()));
    const skills = [...new Map([...own, ...found].map((skill) => [skill.toLowerCase(), skill])).values()].slice(0, MAX_SKILLS);
    if (searches.length > 0) return { searches, skills, fromModel: true };
  } catch {
    // Fall back to the profile's own titles below.
  }
  const titles = [...profile.positions.map((position) => position.title), profile.headline.split(/[|,]/)[0] ?? ""]
    .map((title) => title.trim())
    .filter(Boolean);
  return { searches: [...new Set(titles)].slice(0, MAX_QUERIES), skills: own, fromModel: false };
}

// --- Text helpers ---

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", hellip: "…" };
  return text.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] === "#") {
      const number = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
    }
    return named[code.toLowerCase()] ?? entity;
  });
}

function remoteLocation(restrictions: string[]): string {
  if (restrictions.length === 0) return "Remote (anywhere)";
  if (restrictions.length > 3) return `Remote (${restrictions.slice(0, 3).join(", ")} and ${restrictions.length - 3} more)`;
  return `Remote (${restrictions.join(", ")})`;
}

function salaryText(min: number | null | undefined, max: number | null | undefined, currency: string | undefined): string | null {
  const format = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const unit = currency ? `${currency} ` : "";
  if (min && max && min !== max) return `${unit}${format(min)}–${format(max)}`;
  if (min || max) return `${unit}${format((min || max)!)}`;
  return null;
}

// --- Saved searches ---

// A search you want to run again. `seen` holds the ids of jobs it has already shown, so the next run can mark
// what's new since last time. Kept in the settings table.
export type SavedSearch = {
  id: string;
  name: string;
  queries: string[];
  country: string;
  place: string;
  skills: string[];
  seen: string[];
  lastRun: string | null;
  createdAt: string;
};

const SAVED_SEARCHES = "jobSearches";
const MAX_SAVED_SEARCHES = 20;
const MAX_SEEN = 3000;

export function listSavedSearches(): SavedSearch[] {
  return readSetting<SavedSearch[]>(SAVED_SEARCHES) ?? [];
}

export function addSavedSearch(input: SearchInput & { name: string }): SavedSearch | string {
  const searches = listSavedSearches();
  if (searches.length >= MAX_SAVED_SEARCHES) return `You can keep up to ${MAX_SAVED_SEARCHES} saved searches. Delete one first.`;
  const search: SavedSearch = {
    id: randomUUID(),
    name: input.name.trim().slice(0, 100) || input.queries.join(", ").slice(0, 100),
    queries: input.queries,
    country: input.country,
    place: input.place,
    skills: input.skills,
    seen: [],
    lastRun: null,
    createdAt: new Date().toISOString(),
  };
  writeSetting(SAVED_SEARCHES, [...searches, search]);
  return search;
}

export function deleteSavedSearch(id: string): boolean {
  const searches = listSavedSearches();
  const kept = searches.filter((search) => search.id !== id);
  writeSetting(SAVED_SEARCHES, kept);
  return kept.length < searches.length;
}

// Marks which results the saved search hasn't shown before (none on its first run, which only records them),
// and remembers them all for next time.
export function markNew(id: string, results: FoundJob[]): FoundJob[] {
  const searches = listSavedSearches();
  const search = searches.find((item) => item.id === id);
  if (!search) return results;
  const seen = new Set(search.seen);
  const firstRun = search.lastRun === null;
  const marked = results.map((job) => ({ ...job, isNew: !firstRun && !seen.has(job.id) }));
  const updated = { ...search, seen: [...new Set([...results.map((job) => job.id), ...search.seen])].slice(0, MAX_SEEN), lastRun: new Date().toISOString() };
  writeSetting(SAVED_SEARCHES, searches.map((item) => (item.id === id ? updated : item)));
  return marked;
}
