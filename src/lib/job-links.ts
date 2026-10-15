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
export type SourceName = "Himalayas" | "Jobicy" | "Adzuna";

export const SOURCE_SITES: Record<SourceName, string> = {
  Himalayas: "https://himalayas.app",
  Jobicy: "https://jobicy.com",
  Adzuna: "https://www.adzuna.com",
};

export const MAX_QUERIES = 3;
export const MAX_SKILLS = 30;

export type SearchInput = { queries: string[]; country: string; place: string; skills: string[] };

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
  return { queries, country, place, skills };
}
