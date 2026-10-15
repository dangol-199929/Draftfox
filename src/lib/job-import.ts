// Server-only: reads a job's details from a link you paste, or from posting text you paste, for "Paste a job" on
// the Jobs page. Only the one page you paste is fetched, once, when you ask. Most job sites describe their postings
// in the page for search engines (schema.org JobPosting); when a page doesn't, the local model picks the details
// out of the page's text.
import { isIP } from "node:net";
import { htmlToText } from "./job-search.ts";
import { generateJson } from "./ollama.ts";

export type ImportedJob = { title: string; company: string; location: string; url: string; description: string; salary: string; postedAt: string | null };

const TIMEOUT = 15_000;
const MAX_PAGE = 3_000_000;
const MAX_TEXT = 20_000;
const MAX_REDIRECTS = 5;

// Addresses on this computer or your home network are never fetched.
function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (isIP(host) === 6) return host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") || host.startsWith("::ffff:");
  return !host.includes(".");
}

export function checkLink(link: string): URL | string {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return "That doesn't look like a link. It should start with https://";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "Only web links (https://) can be read.";
  if (isPrivateHost(url.hostname)) return "That link points to this computer or your own network, so it isn't read.";
  return url;
}

// Follows redirects by hand so each step can be checked.
async function fetchPage(start: URL): Promise<{ html: string; url: string }> {
  let url = start;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT),
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en",
      },
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      const next = checkLink(new URL(location, url).toString());
      if (typeof next === "string") throw new Error(next);
      url = next;
      continue;
    }
    if (!response.ok) {
      throw new Error(
        response.status === 999 || response.status === 403 || response.status === 401
          ? `${url.hostname} didn't let Draftfox read that page. Open it, copy the job description and paste the text instead.`
          : `${url.hostname} answered with status ${response.status}. Paste the job's text instead.`,
      );
    }
    const html = (await response.text()).slice(0, MAX_PAGE);
    return { html, url: url.toString() };
  }
  throw new Error("That link redirects too many times. Paste the job's text instead.");
}

type Json = Record<string, unknown>;

// Every JobPosting described in the page's JSON-LD blocks, wherever it sits (a list, an @graph, nested).
function jobPostings(html: string): Json[] {
  const found: Json[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      const item = value as Json;
      const type = item["@type"];
      if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) found.push(item);
      else Object.values(item).forEach(visit);
    }
  };
  for (const match of html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(match[1].trim()));
    } catch {
      // A broken block on the page; try the next one.
    }
  }
  return found;
}

const text = (value: unknown): string => (typeof value === "string" ? htmlToText(value).trim() : typeof value === "number" ? String(value) : "");
const name = (value: unknown): string => (value && typeof value === "object" ? text((value as Json).name) : text(value));
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : value ? [value] : []);

function postingLocation(posting: Json): string {
  const places = list(posting.jobLocation)
    .map((place) => {
      const address = (place as Json)?.address;
      if (!address || typeof address !== "object") return text(address);
      const parts = address as Json;
      return [parts.addressLocality, parts.addressRegion, name(parts.addressCountry)].map(text).filter(Boolean).join(", ");
    })
    .filter(Boolean);
  const remote = list(posting.jobLocationType).some((type) => text(type).toUpperCase() === "TELECOMMUTE");
  const where = [...new Set(places)].slice(0, 3).join("; ");
  return remote ? (where ? `Remote (${where})` : "Remote") : where;
}

function postingSalary(posting: Json): string {
  const salary = posting.baseSalary as Json | undefined;
  if (!salary || typeof salary !== "object") return text(salary);
  const value = (salary.value ?? {}) as Json;
  const currency = text(salary.currency);
  const unit = text(value.unitText).toLowerCase();
  const amount =
    value.minValue && value.maxValue && value.minValue !== value.maxValue
      ? `${text(value.minValue)}–${text(value.maxValue)}`
      : text(value.value ?? value.minValue ?? value.maxValue);
  return amount ? [currency, amount, unit && `per ${unit}`].filter(Boolean).join(" ") : "";
}

function fromPosting(posting: Json, url: string): ImportedJob {
  const posted = text(posting.datePosted);
  return {
    title: text(posting.title),
    company: name(posting.hiringOrganization),
    location: postingLocation(posting),
    url,
    description: text(posting.description).slice(0, MAX_TEXT),
    salary: postingSalary(posting),
    postedAt: posted && !Number.isNaN(Date.parse(posted)) ? new Date(posted).toISOString() : null,
  };
}

// The readable text of a page, without its scripts, styles and menus.
function pageText(html: string): string {
  return htmlToText(
    html
      .replace(/<(script|style|noscript|svg|nav|header|footer)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " "),
  ).slice(0, MAX_TEXT);
}

const EXTRACT_SYSTEM = `You read a job posting and copy its details exactly as written.
- title: the job title.
- company: the employer's name ("" if not given; not the job board's name).
- location: the city, region and country, or "Remote", as written ("" if not given).
- salary: the pay as written ("" if not given).
- description: the posting's own text (about the role, responsibilities, requirements, benefits), copied word for word. Leave out site menus, cookie notices, other jobs and sign-up prompts.
Never invent anything that isn't in the text.`;

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    company: { type: "string" },
    location: { type: "string" },
    salary: { type: "string" },
    description: { type: "string" },
  },
  required: ["title", "company", "location", "salary", "description"],
};

type Extracted = { title?: unknown; company?: unknown; location?: unknown; salary?: unknown; description?: unknown };

async function extract(source: string): Promise<Extracted> {
  return generateJson<Extracted>(`POSTING\n${source}`, EXTRACT_SYSTEM, EXTRACT_SCHEMA);
}

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

// A job from a link: the page's own description of the posting, or else the model reading the page's text.
export async function importFromLink(url: URL): Promise<ImportedJob> {
  const page = await fetchPage(url);
  const posting = jobPostings(page.html).find((item) => text(item.title));
  if (posting) {
    const job = fromPosting(posting, page.url);
    if (job.description) return job;
  }
  const body = pageText(page.html);
  if (body.length < 200) {
    throw new Error(`${url.hostname} didn't show the job without signing in. Open it, copy the job description and paste the text instead.`);
  }
  const reply = await extract(body);
  return {
    title: clean(reply.title, 200),
    company: clean(reply.company, 200),
    location: clean(reply.location, 200),
    url: page.url,
    // The model's copy can come out shorter than the page; keep the page's text when it does.
    description: clean(reply.description, MAX_TEXT).length > 200 ? clean(reply.description, MAX_TEXT) : body,
    salary: clean(reply.salary, 200),
    postedAt: null,
  };
}

// A job from pasted text: the text stays the description; the model fills in the title, company and location.
// Without the model, you fill those in yourself.
export async function importFromText(pasted: string): Promise<ImportedJob> {
  const description = pasted.trim().slice(0, MAX_TEXT);
  const job: ImportedJob = { title: "", company: "", location: "", url: "", description, salary: "", postedAt: null };
  try {
    const reply = await extract(description.slice(0, 8000));
    job.title = clean(reply.title, 200);
    job.company = clean(reply.company, 200);
    job.location = clean(reply.location, 200);
    job.salary = clean(reply.salary, 200);
  } catch {
    // Leave the boxes for you to fill in.
  }
  // A link in the text is most likely the posting's own.
  job.url = description.match(/https?:\/\/[^\s<>"')]+/)?.[0] ?? "";
  return job;
}
