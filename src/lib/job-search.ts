// Server-only: finds job postings for the Jobs page through job boards' public APIs, and ranks them against your
// profile. Only the search words (and country) are sent; your profile never leaves this computer.
// - Himalayas (himalayas.app) and Jobicy (jobicy.com): remote jobs, no key needed.
// - Adzuna (adzuna.com): jobs in many countries, with a free API key in ADZUNA_APP_ID and ADZUNA_APP_KEY.
// - JSearch (on RapidAPI): jobs Google for Jobs found on LinkedIn, Indeed, Glassdoor and others, with a RapidAPI
//   key in JSEARCH_API_KEY (free plan with a monthly limit).
// - Jooble (jooble.org) and Careerjet (careerjet.com): job search engines, with free keys in JOOBLE_API_KEY and
//   CAREERJET_API_KEY.
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
  // For sources that collect jobs from other sites (JSearch): the site the posting is on, like "LinkedIn".
  via?: string;
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
  // Added by the search route: the posting's keywords your profile does and doesn't mention, and the share it does.
  keywords?: { found: string[]; missing: string[] };
  fit?: number | null;
};

export type SourceResult = { name: SourceName; count: number; error?: string; skipped?: string };

type Found = Omit<FoundJob, "matched" | "score">;

// --- Sources ---

async function getJson<T>(url: string, headers: Record<string, string> = {}, timeout = TIMEOUT): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { Accept: "application/json", ...headers } });
  if (response.status === 429) throw new Error("too many searches, or this month's free searches are used up; try again later");
  if (response.status === 401 || response.status === 403) {
    const body = (await response.json().catch(() => ({}))) as { error?: unknown };
    // Careerjet only answers the internet addresses registered in your partner account.
    const ip = typeof body.error === "string" ? body.error.match(/from IP (\S+)/)?.[1] : undefined;
    if (ip) throw new Error(`only accepts searches from addresses registered in your account; add ${ip} there`);
    throw new Error("rejected the API key; check it in .env");
  }
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

type JSearchJob = {
  job_id: string;
  job_title: string;
  employer_name?: string;
  job_publisher?: string;
  job_apply_link?: string;
  job_google_link?: string;
  job_description?: string;
  job_location?: string;
  job_city?: string | null;
  job_state?: string | null;
  job_country?: string | null;
  job_is_remote?: boolean | null;
  job_posted_at_datetime_utc?: string | null;
  job_min_salary?: number | null;
  job_max_salary?: number | null;
  job_salary_currency?: string | null;
  job_salary_string?: string | null;
};

export function jsearchConfigured(): boolean {
  return Boolean(process.env.JSEARCH_API_KEY);
}

const JSEARCH_DATES: Record<string, string> = { "1": "today", "7": "week", "30": "month" };

async function jsearch(query: string, input: SearchInput): Promise<Found[]> {
  const where = [input.place.trim(), findCountry(input.country)?.name].filter(Boolean).join(", ");
  const params = new URLSearchParams({ query: where ? `${query} in ${where}` : query, num_pages: "1" });
  if (input.country) params.set("country", input.country === "gb" ? "uk" : input.country);
  if (input.postedWithin) params.set("date_posted", JSEARCH_DATES[input.postedWithin]);
  if (input.remoteOnly) params.set("work_from_home", "true");
  // JSearch gathers results live from the job sites, so it can take longer than the others.
  const data = await getJson<{ data?: { jobs?: JSearchJob[] } | JSearchJob[] }>(
    `https://jsearch.p.rapidapi.com/search-v2?${params}`,
    { "X-RapidAPI-Key": process.env.JSEARCH_API_KEY ?? "", "X-RapidAPI-Host": "jsearch.p.rapidapi.com" },
    30_000,
  );
  const jobs = Array.isArray(data.data) ? data.data : (data.data?.jobs ?? []);
  return jobs.map((job) => {
    const place = job.job_location || [job.job_city, job.job_state, job.job_country].filter(Boolean).join(", ");
    return {
      id: `jsearch:${job.job_id}`,
      source: "JSearch",
      via: job.job_publisher || undefined,
      title: job.job_title,
      company: job.employer_name ?? "",
      location: job.job_is_remote ? (place ? `Remote (${place})` : "Remote") : place,
      url: job.job_apply_link || job.job_google_link || "",
      description: htmlToText(job.job_description ?? ""),
      postedAt: job.job_posted_at_datetime_utc ?? null,
      salary: job.job_salary_string || salaryText(job.job_min_salary, job.job_max_salary, job.job_salary_currency ?? undefined),
    };
  });
}

type JoobleJob = { id: number | string; title: string; company?: string; location?: string; snippet?: string; salary?: string; link: string; updated?: string; source?: string };

export function joobleConfigured(): boolean {
  return Boolean(process.env.JOOBLE_API_KEY);
}

async function jooble(query: string, input: SearchInput): Promise<Found[]> {
  const where = input.remoteOnly ? "Remote" : [input.place.trim(), findCountry(input.country)?.name].filter(Boolean).join(", ");
  const response = await fetch(`https://jooble.org/api/${encodeURIComponent(process.env.JOOBLE_API_KEY ?? "")}`, {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ keywords: query, location: where, page: "1", ResultOnPage: "30" }),
  });
  if (response.status === 403 || response.status === 401) throw new Error("rejected the API key; check JOOBLE_API_KEY");
  if (!response.ok) throw new Error(`returned ${response.status}`);
  const data = (await response.json()) as { jobs?: JoobleJob[] };
  return (data.jobs ?? []).map((job) => ({
    id: `jooble:${job.id}`,
    source: "Jooble",
    title: htmlToText(job.title),
    company: job.company ?? "",
    location: job.location ?? "",
    url: job.link,
    // Jooble gives a short snippet; the full posting is on the job's page.
    description: htmlToText(job.snippet ?? ""),
    postedAt: job.updated && !Number.isNaN(Date.parse(job.updated)) ? new Date(job.updated).toISOString() : null,
    salary: job.salary || null,
  }));
}

type CareerjetJob = { title: string; company?: string; date?: string; description?: string; locations?: string; salary?: string; url: string };

export function careerjetConfigured(): boolean {
  return Boolean(process.env.CAREERJET_API_KEY);
}

// Careerjet's language and country for each country we search.
const CAREERJET_LOCALES: Record<string, string> = {
  au: "en_AU", nz: "en_NZ", gb: "en_GB", us: "en_US", ca: "en_CA", in: "en_IN", sg: "en_SG", de: "de_DE", nl: "nl_NL",
  fr: "fr_FR", es: "es_ES", it: "it_IT", at: "de_AT", be: "fr_BE", ch: "de_CH", pl: "pl_PL", br: "pt_BR", mx: "es_MX", za: "en_ZA",
};

// Careerjet asks for the IP address and browser of the person searching, so it can tell searches from bots.
export type Searcher = { ip: string; userAgent: string };

async function careerjet(query: string, input: SearchInput, searcher: Searcher): Promise<Found[]> {
  const params = new URLSearchParams({
    keywords: input.remoteOnly ? `${query} remote` : query,
    locale_code: CAREERJET_LOCALES[input.country] ?? "en_GB",
    page_size: "30",
    sort: input.postedWithin ? "date" : "relevance",
    user_ip: searcher.ip,
    user_agent: searcher.userAgent,
  });
  if (input.place.trim() && !input.remoteOnly) params.set("location", input.place.trim());
  const data = await getJson<{ type?: string; message?: string; jobs?: CareerjetJob[] }>(
    `https://search.api.careerjet.net/v4/query?${params}`,
    { Authorization: `Basic ${Buffer.from(`${process.env.CAREERJET_API_KEY ?? ""}:`).toString("base64")}` },
  );
  // LOCATIONS means the city was ambiguous; there are no jobs to show for it.
  if (data.type && data.type !== "JOBS" && data.type !== "LOCATIONS") throw new Error(data.message ?? "failed");
  return (data.jobs ?? []).map((job) => ({
    id: `careerjet:${job.url}`,
    source: "Careerjet",
    title: htmlToText(job.title),
    company: job.company ?? "",
    location: job.locations ?? "",
    url: job.url,
    description: htmlToText(job.description ?? ""),
    postedAt: job.date && !Number.isNaN(Date.parse(job.date)) ? new Date(job.date).toISOString() : null,
    salary: job.salary || null,
  }));
}

// --- Search ---


// Runs each search on each source at once. A source that fails is reported, not fatal.
export async function searchJobs(
  input: SearchInput,
  profile: Profile | null,
  searcher: Searcher,
): Promise<{ results: FoundJob[]; sources: SourceResult[] }> {
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
    {
      name: "JSearch",
      skipped: !jsearchConfigured() ? "add a RapidAPI key for JSearch to include LinkedIn, Indeed and Glassdoor jobs" : undefined,
      run: (query) => jsearch(query, input),
    },
    {
      name: "Jooble",
      skipped: !joobleConfigured() ? "add a free Jooble API key to search it" : undefined,
      run: (query) => jooble(query, input),
    },
    {
      name: "Careerjet",
      skipped: !careerjetConfigured() ? "add a free Careerjet API key to search it" : !country ? "pick a country to search it" : undefined,
      run: (query) => careerjet(query, input, searcher),
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

  return { results: rank(dedupe(found.filter((job) => fitsPrefs(job, input))), profile, queries, input.skills), sources };
}

// Remote only and posted within, for the sources that can't filter by them themselves.
function fitsPrefs(job: Found, input: SearchInput): boolean {
  if (input.remoteOnly && !/remote|anywhere|work from home|wfh/i.test(`${job.location} ${job.title}`)) return false;
  if (input.postedWithin && job.postedAt && Date.now() - Date.parse(job.postedAt) > Number(input.postedWithin) * 86_400_000) return false;
  return true;
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
