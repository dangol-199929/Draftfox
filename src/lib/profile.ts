// Server-only: the optional author profile in data/profile.json, filled by hand or from a LinkedIn data export.
// Only the fields below are kept from an export; addresses, birth dates, contacts and messages are ignored.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { unzipSync } from "fflate";
import type { PostContext } from "./prompts.ts";

export type Position = {
  company: string;
  title: string;
  description: string;
  location: string;
  startedOn: string;
  finishedOn: string;
};

export type Education = {
  school: string;
  degree: string;
  startDate: string;
  endDate: string;
};

export type PastPost = { date: string; text: string };

export type Profile = {
  importedAt: string | null;
  name: string;
  headline: string;
  summary: string;
  industry: string;
  location: string;
  positions: Position[];
  skills: string[];
  education: Education[];
  posts: PastPost[];
  facts: string;
  // The text of your CV, pasted or imported from a .docx or .txt file. Used on the Jobs page, not in posts.
  cv: string;
  useFacts: boolean;
  useStyle: boolean;
};

export type ImportSummary = {
  files: string[];
  profile: boolean;
  positions: number;
  skills: number;
  education: number;
  posts: number;
};

export const EMPTY_PROFILE: Profile = {
  importedAt: null,
  name: "",
  headline: "",
  summary: "",
  industry: "",
  location: "",
  positions: [],
  skills: [],
  education: [],
  posts: [],
  facts: "",
  cv: "",
  useFacts: true,
  useStyle: true,
};

const DATA_DIR = join(process.cwd(), "data");
const PROFILE_FILE = join(DATA_DIR, "profile.json");

const MAX_POSTS = 50;
const PROMPT_SKILLS = 15;
const PROMPT_EXAMPLES = 3;
const EXAMPLE_LENGTH = 700;

export async function readProfile(): Promise<Profile | null> {
  let text: string;
  try {
    text = await readFile(PROFILE_FILE, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not read ${PROFILE_FILE}:`, (error as Error).message);
    }
    return null;
  }
  try {
    const parsed = validateProfile(JSON.parse(text));
    if (typeof parsed === "string") throw new Error(parsed);
    return parsed;
  } catch (error) {
    console.warn(`${PROFILE_FILE} is not valid, ignoring it:`, (error as Error).message);
    return null;
  }
}

// Write to a temp file first so a crash mid-write can't leave a half-written file.
export async function saveProfile(profile: Profile): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const temp = `${PROFILE_FILE}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(profile, null, 2)}\n`);
  await rename(temp, PROFILE_FILE);
}

export async function deleteProfile(): Promise<void> {
  await rm(PROFILE_FILE, { force: true });
}

// --- Prompt context ---

// Builds the extra prompt sections from the saved profile, or nothing when it's off or empty.
export function buildPostContext(profile: Profile | null): PostContext | undefined {
  if (!profile) return undefined;
  const context: PostContext = {};

  if (profile.useFacts) {
    const current = profile.positions.filter((position) => !position.finishedOn);
    const lines = [
      profile.headline && `Headline: ${profile.headline}`,
      current.length > 0 &&
        `Current role${current.length > 1 ? "s" : ""}: ${current
          .map((position) => [position.title, position.company].filter(Boolean).join(" at "))
          .join("; ")}`,
      profile.skills.length > 0 && `Skills: ${profile.skills.slice(0, PROMPT_SKILLS).join(", ")}`,
      profile.facts.trim() && `Facts: ${profile.facts.trim()}`,
    ].filter(Boolean);
    if (lines.length > 0) context.background = lines.join("\n");
  }

  if (profile.useStyle && profile.posts.length > 0) {
    context.examples = profile.posts
      .slice(0, PROMPT_EXAMPLES)
      .map((post) => (post.text.length > EXAMPLE_LENGTH ? `${post.text.slice(0, EXAMPLE_LENGTH).trimEnd()}…` : post.text));
  }

  return context.background || context.examples ? context : undefined;
}

// --- LinkedIn export import ---

type UploadedFile = { name: string; data: Uint8Array };

const WANTED = ["profile.csv", "positions.csv", "skills.csv", "education.csv", "shares.csv"];

// Reads the wanted CSVs from uploaded .zip and .csv files (in memory only) and merges them into the profile.
export async function importExport(uploads: UploadedFile[]): Promise<{ profile: Profile; summary: ImportSummary }> {
  const csvs = new Map<string, string>();
  const decoder = new TextDecoder("utf-8");

  for (const upload of uploads) {
    if (upload.name.toLowerCase().endsWith(".zip")) {
      const entries = unzipSync(upload.data, {
        filter: (file) => WANTED.includes(basename(file.name).toLowerCase()),
      });
      for (const [name, data] of Object.entries(entries)) {
        csvs.set(basename(name).toLowerCase(), decoder.decode(data));
      }
    } else if (WANTED.includes(basename(upload.name).toLowerCase())) {
      csvs.set(basename(upload.name).toLowerCase(), decoder.decode(upload.data));
    }
  }

  const profile = { ...((await readProfile()) ?? EMPTY_PROFILE) };
  const summary: ImportSummary = {
    files: [...csvs.keys()].sort(),
    profile: false,
    positions: 0,
    skills: 0,
    education: 0,
    posts: 0,
  };

  const profileCsv = csvs.get("profile.csv");
  if (profileCsv) {
    const row = csvRecords(profileCsv, "first name")[0];
    if (row) {
      profile.name = [row["first name"], row["last name"]].filter(Boolean).join(" ");
      profile.headline = row["headline"] ?? "";
      profile.summary = row["summary"] ?? "";
      profile.industry = row["industry"] ?? "";
      profile.location = row["geo location"] ?? "";
      summary.profile = true;
    }
  }

  const positionsCsv = csvs.get("positions.csv");
  if (positionsCsv) {
    profile.positions = csvRecords(positionsCsv, "company name")
      .map((row) => ({
        company: row["company name"] ?? "",
        title: row["title"] ?? "",
        description: row["description"] ?? "",
        location: row["location"] ?? "",
        startedOn: row["started on"] ?? "",
        finishedOn: row["finished on"] ?? "",
      }))
      .filter((position) => position.company || position.title);
    summary.positions = profile.positions.length;
  }

  const skillsCsv = csvs.get("skills.csv");
  if (skillsCsv) {
    profile.skills = [...new Set(csvRecords(skillsCsv, "name").map((row) => row["name"] ?? "").filter(Boolean))];
    summary.skills = profile.skills.length;
  }

  const educationCsv = csvs.get("education.csv");
  if (educationCsv) {
    profile.education = csvRecords(educationCsv, "school name")
      .map((row) => ({
        school: row["school name"] ?? "",
        degree: row["degree name"] ?? "",
        startDate: row["start date"] ?? "",
        endDate: row["end date"] ?? "",
      }))
      .filter((education) => education.school);
    summary.education = profile.education.length;
  }

  const sharesCsv = csvs.get("shares.csv");
  if (sharesCsv) {
    profile.posts = csvRecords(sharesCsv, "sharecommentary")
      .map((row) => ({ date: row["date"] ?? "", text: cleanCommentary(row["sharecommentary"] ?? "") }))
      .filter((post) => post.text)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, MAX_POSTS);
    summary.posts = profile.posts.length;
  }

  if (csvs.size > 0) profile.importedAt = new Date().toISOString();
  return { profile, summary };
}

// Some exports wrap the whole commentary in an extra pair of quotes.
function cleanCommentary(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 1 && trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1).trim() : trimmed;
}

// Rows as objects keyed by lower-cased header. The header row is the first row containing `headerHint`,
// which skips the "Notes:" lines some LinkedIn exports put above the header.
function csvRecords(text: string, headerHint: string): Record<string, string>[] {
  const rows = parseCsv(text);
  const headerIndex = rows.findIndex((row) => row.some((cell) => cell.trim().toLowerCase() === headerHint));
  if (headerIndex === -1) return [];
  const headers = rows[headerIndex].map((cell) => cell.trim().toLowerCase());
  return rows
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) =>
      Object.fromEntries(headers.map((header, i) => [header, (row[i] ?? "").replace(/\r\n?/g, "\n").trim()])),
    );
}

// RFC 4180: quoted fields, "" for a quote inside quotes, newlines inside quotes, CRLF or LF, optional UTF-8 BOM.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  for (; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// --- Validation for PUT /api/profile ---

const LIMITS = { short: 300, long: 10_000, list: 200, cv: 30_000 };

export function validateProfile(value: unknown): Profile | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "Profile must be a JSON object.";
  const data = value as Record<string, unknown>;

  const text = (field: string, max: number): string | null => {
    const v = data[field] ?? "";
    return typeof v === "string" && v.length <= max ? v : null;
  };
  const list = <T>(field: string, item: (v: unknown) => T | null): T[] | null => {
    const v = data[field] ?? [];
    if (!Array.isArray(v) || v.length > LIMITS.list) return null;
    const items = v.map(item);
    return items.every((x) => x !== null) ? (items as T[]) : null;
  };
  const record = <K extends string>(keys: K[], max: number) => (v: unknown): Record<K, string> | null => {
    if (typeof v !== "object" || v === null) return null;
    const out = {} as Record<K, string>;
    for (const key of keys) {
      const s = (v as Record<string, unknown>)[key] ?? "";
      if (typeof s !== "string" || s.length > max) return null;
      out[key] = s;
    }
    return out;
  };

  const strings = {
    name: text("name", LIMITS.short),
    headline: text("headline", LIMITS.short),
    summary: text("summary", LIMITS.long),
    industry: text("industry", LIMITS.short),
    location: text("location", LIMITS.short),
    facts: text("facts", LIMITS.long),
    cv: text("cv", LIMITS.cv),
  };
  for (const [field, v] of Object.entries(strings)) {
    if (v === null) return `"${field}" must be text of reasonable length.`;
  }

  const positions = list("positions", record(["company", "title", "description", "location", "startedOn", "finishedOn"], LIMITS.long));
  if (!positions) return `"positions" must be a list of positions.`;
  const skills = list("skills", (v) => (typeof v === "string" && v.length <= LIMITS.short ? v : null));
  if (!skills) return `"skills" must be a list of short texts.`;
  const education = list("education", record(["school", "degree", "startDate", "endDate"], LIMITS.short));
  if (!education) return `"education" must be a list of schools.`;
  const posts = list("posts", record(["date", "text"], LIMITS.long));
  if (!posts) return `"posts" must be a list of posts.`;

  const importedAt = data.importedAt ?? null;
  if (importedAt !== null && typeof importedAt !== "string") return `"importedAt" must be a date string.`;
  for (const flag of ["useFacts", "useStyle"]) {
    if (data[flag] !== undefined && typeof data[flag] !== "boolean") return `"${flag}" must be true or false.`;
  }

  return {
    importedAt,
    name: strings.name!,
    headline: strings.headline!,
    summary: strings.summary!,
    industry: strings.industry!,
    location: strings.location!,
    positions,
    skills,
    education,
    posts,
    facts: strings.facts!,
    cv: strings.cv!,
    useFacts: data.useFacts !== false,
    useStyle: data.useStyle !== false,
  };
}

// --- CV import ---

// Reads the text of a CV: a Word .docx (the text of word/document.xml, paragraph by paragraph) or plain text.
// Nothing is saved here; the text goes into the Profile page for you to check and save.
export function readCvFile(name: string, data: Uint8Array): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".docx")) {
    const entries = unzipSync(data, { filter: (file) => file.name === "word/document.xml" });
    const xml = entries["word/document.xml"];
    if (!xml) throw new Error("This .docx has no document text.");
    return docxText(new TextDecoder("utf-8").decode(xml));
  }
  if (/\.(txt|md|text)$/.test(lower)) return new TextDecoder("utf-8").decode(data).replace(/\r\n?/g, "\n").trim();
  throw new Error("Choose a .docx or .txt file. For a PDF, open it, copy the text and paste it into the CV box.");
}

function docxText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:(br|cr)\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(lt|gt|amp|quot|apos|#\d+|#x[\da-f]+);/gi, (entity, code: string) => {
      const named: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
      if (named[code.toLowerCase()]) return named[code.toLowerCase()];
      const number = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
