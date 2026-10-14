// Countries for the job search, and search links to job sites you open yourself. Shared by the server and the page.
// The codes are Adzuna's country codes; Himalayas takes the country name.

export type Country = { code: string; name: string; indeed: string; seek?: string };

export const COUNTRIES: Country[] = [
  { code: "au", name: "Australia", indeed: "au.indeed.com", seek: "www.seek.com.au" },
  { code: "nz", name: "New Zealand", indeed: "nz.indeed.com", seek: "www.seek.co.nz" },
  { code: "gb", name: "United Kingdom", indeed: "uk.indeed.com" },
  { code: "us", name: "United States", indeed: "www.indeed.com" },
  { code: "ca", name: "Canada", indeed: "ca.indeed.com" },
  { code: "in", name: "India", indeed: "in.indeed.com" },
  { code: "sg", name: "Singapore", indeed: "sg.indeed.com" },
  { code: "de", name: "Germany", indeed: "de.indeed.com" },
  { code: "nl", name: "Netherlands", indeed: "nl.indeed.com" },
  { code: "fr", name: "France", indeed: "fr.indeed.com" },
  { code: "es", name: "Spain", indeed: "es.indeed.com" },
  { code: "it", name: "Italy", indeed: "it.indeed.com" },
  { code: "at", name: "Austria", indeed: "at.indeed.com" },
  { code: "be", name: "Belgium", indeed: "be.indeed.com" },
  { code: "ch", name: "Switzerland", indeed: "ch.indeed.com" },
  { code: "pl", name: "Poland", indeed: "pl.indeed.com" },
  { code: "br", name: "Brazil", indeed: "br.indeed.com" },
  { code: "mx", name: "Mexico", indeed: "mx.indeed.com" },
  { code: "za", name: "South Africa", indeed: "za.indeed.com" },
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

export type SearchLink = { site: string; url: string };

// Links to the same search on job sites. Nothing is fetched from them; you open the links yourself.
export function searchLinks(query: string, countryCode: string, place: string): SearchLink[] {
  const country = findCountry(countryCode);
  const where = place.trim() || country?.name || "";
  const q = encodeURIComponent(query.trim());
  const l = encodeURIComponent(where);
  const links: SearchLink[] = [
    { site: "LinkedIn", url: `https://www.linkedin.com/jobs/search/?keywords=${q}${where ? `&location=${l}` : ""}` },
  ];
  if (country?.seek) links.push({ site: "Seek", url: `https://${country.seek}/jobs?keywords=${q}${where ? `&where=${l}` : ""}` });
  links.push({ site: "Indeed", url: `https://${country?.indeed ?? "www.indeed.com"}/jobs?q=${q}${where ? `&l=${l}` : ""}` });
  return links;
}

// The job boards searched through their APIs. Results credit them with a link, as they ask.
export type SourceName = "Himalayas" | "Jobicy" | "Adzuna";

export const SOURCE_SITES: Record<SourceName, string> = {
  Himalayas: "https://himalayas.app",
  Jobicy: "https://jobicy.com",
  Adzuna: "https://www.adzuna.com",
};
