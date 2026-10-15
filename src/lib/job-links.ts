// Countries for the job search and the shape of a search. Shared by the server and the page.
// The codes are Adzuna's country codes; Himalayas takes the country name.

export type Country = { code: string; name: string };

export const COUNTRIES: Country[] = [
  { code: "au", name: "Australia" },
  { code: "nz", name: "New Zealand" },
  { code: "gb", name: "United Kingdom" },
  { code: "us", name: "United States" },
  { code: "ca", name: "Canada" },
  { code: "in", name: "India" },
  { code: "sg", name: "Singapore" },
  { code: "de", name: "Germany" },
  { code: "nl", name: "Netherlands" },
  { code: "fr", name: "France" },
  { code: "es", name: "Spain" },
  { code: "it", name: "Italy" },
  { code: "at", name: "Austria" },
  { code: "be", name: "Belgium" },
  { code: "ch", name: "Switzerland" },
  { code: "pl", name: "Poland" },
  { code: "br", name: "Brazil" },
  { code: "mx", name: "Mexico" },
  { code: "za", name: "South Africa" },
];

export function findCountry(code: string): Country | undefined {
  return COUNTRIES.find((country) => country.code === code);
}

const ALIASES: Record<string, string> = { uk: "gb", england: "gb", usa: "us", "united states of america": "us" };

// "Sydney, New South Wales, Australia" -> "au". Empty when no listed country is named.
export function countryFromLocation(location: string): string {
  const lower = location.toLowerCase();
  const byName = COUNTRIES.find((country) => lower.includes(country.name.toLowerCase()));
  if (byName) return byName.code;
  const alias = Object.keys(ALIASES).find((name) => new RegExp(`\\b${name}\\b`).test(lower));
  return alias ? ALIASES[alias] : "";
}

// The job boards searched through their APIs. Results credit them with a link, as they ask.
export type SourceName = "Himalayas" | "Jobicy" | "Adzuna" | "JSearch" | "Jooble" | "Careerjet";

export const SOURCE_SITES: Record<SourceName, string> = {
  Himalayas: "https://himalayas.app",
  Jobicy: "https://jobicy.com",
  Adzuna: "https://www.adzuna.com",
  JSearch: "https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch",
  Jooble: "https://jooble.org",
  Careerjet: "https://www.careerjet.com",
};

export const MAX_QUERIES = 3;
export const MAX_SKILLS = 30;

// How recently a job was posted, in days ("" for any time).
export const POSTED_WITHIN = [
  { value: "", label: "Any time" },
  { value: "1", label: "Past 24 hours" },
  { value: "7", label: "Past week" },
  { value: "30", label: "Past month" },
] as const;
export type PostedWithin = (typeof POSTED_WITHIN)[number]["value"];

export type SearchPrefs = { remoteOnly: boolean; postedWithin: PostedWithin };
export const DEFAULT_PREFS: SearchPrefs = { remoteOnly: false, postedWithin: "" };

export type SearchInput = { queries: string[]; country: string; place: string; skills: string[] } & SearchPrefs;

// Checks a search from a request body: 1 to 3 queries, a known country (or "" for anywhere), a place and skills.
export function parseSearchInput(body: Record<string, unknown>): SearchInput | string {
  const queries = (Array.isArray(body.queries) ? body.queries : [])
    .map((query) => (typeof query === "string" ? query.trim() : ""))
    .filter(Boolean);
  if (queries.length === 0) return "Add a job title or keywords to search for.";
  if (queries.length > MAX_QUERIES || queries.some((query) => query.length > 100)) {
    return `Search for at most ${MAX_QUERIES} things at once, each under 100 characters.`;
  }
  const country = typeof body.country === "string" ? body.country : "";
  if (country && !findCountry(country)) return "Unknown country.";
  const place = typeof body.place === "string" ? body.place.trim().slice(0, 100) : "";
  const skills = (Array.isArray(body.skills) ? body.skills : [])
    .filter((skill): skill is string => typeof skill === "string" && skill.trim().length > 0 && skill.length <= 60)
    .slice(0, MAX_SKILLS);
  const remoteOnly = body.remoteOnly === true;
  const postedWithin = POSTED_WITHIN.find((option) => option.value === body.postedWithin)?.value ?? "";
  return { queries, country, place, skills, remoteOnly, postedWithin };
}

// --- Searching on the big job sites yourself ---
// LinkedIn, SEEK and Indeed have no job search API for personal apps, so Find jobs links to their own search pages
// with your search filled in. You browse there with your own account; Draftfox never reads those pages.

export type BoardLink = { name: "LinkedIn" | "SEEK" | "Indeed"; url: string };

const INDEED_HOSTS: Record<string, string> = {
  au: "au.indeed.com", nz: "nz.indeed.com", gb: "uk.indeed.com", us: "www.indeed.com", ca: "ca.indeed.com", in: "in.indeed.com",
  sg: "sg.indeed.com", de: "de.indeed.com", nl: "nl.indeed.com", fr: "fr.indeed.com", es: "es.indeed.com", it: "it.indeed.com",
  at: "at.indeed.com", be: "be.indeed.com", ch: "ch.indeed.com", pl: "pl.indeed.com", br: "br.indeed.com", mx: "mx.indeed.com",
  za: "za.indeed.com",
};

// One search's links: LinkedIn and Indeed everywhere, SEEK in Australia and New Zealand.
export function boardLinks(query: string, country: string, place: string, prefs: SearchPrefs): BoardLink[] {
  const countryName = findCountry(country)?.name ?? "";
  const where = [place.trim(), countryName].filter(Boolean).join(", ");
  const days = prefs.postedWithin;

  const linkedin = new URLSearchParams({ keywords: query });
  if (where) linkedin.set("location", where);
  else if (!prefs.remoteOnly) linkedin.set("location", "Worldwide");
  if (prefs.remoteOnly) linkedin.set("f_WT", "2");
  if (days) linkedin.set("f_TPR", `r${Number(days) * 86_400}`);
  const links: BoardLink[] = [{ name: "LinkedIn", url: `https://www.linkedin.com/jobs/search/?${linkedin}` }];

  if (country === "au" || country === "nz") {
    const seek = new URLSearchParams({ keywords: prefs.remoteOnly ? `${query} remote` : query });
    if (place.trim()) seek.set("where", place.trim());
    if (days) seek.set("daterange", days);
    links.push({ name: "SEEK", url: `https://www.seek.${country === "au" ? "com.au" : "co.nz"}/jobs?${seek}` });
  }

  const indeed = new URLSearchParams({ q: query });
  if (prefs.remoteOnly) indeed.set("l", "Remote");
  else if (place.trim()) indeed.set("l", place.trim());
  if (days) indeed.set("fromage", days);
  links.push({ name: "Indeed", url: `https://${INDEED_HOSTS[country] ?? "www.indeed.com"}/jobs?${indeed}` });
  return links;
}
