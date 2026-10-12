// Server-only: turns the app's own records (generations and the activity log in data/app.db) into the Reports page.
// Nothing here calls LinkedIn; see LINKEDIN_INSIGHTS for what LinkedIn would need to allow before it could.
import { listEvents, listGenerations, type EventRow, type GenerationRow } from "./db.ts";
import { readProfile } from "./profile.ts";
import type { PostInput } from "./prompts.ts";

export const RANGES = ["7", "30", "90", "all"] as const;
export type Range = (typeof RANGES)[number];

export function isRange(value: unknown): value is Range {
  return (RANGES as readonly unknown[]).includes(value);
}

const DAY = 86_400_000;

export type Bucket = { start: string; label: string; drafts: number; published: number };

export type PublishedPost = {
  urn: string;
  url: string;
  at: string;
  visibility: string;
  preview: string;
  characters: number | null;
  deleted: boolean;
};

export type ActivityItem = { at: string; text: string };

export type Report = {
  range: Range;
  // Counts for the chosen range, and for the same length of time just before it (null for "all").
  totals: {
    drafts: number;
    stopped: number;
    failed: number;
    copied: number;
    published: number;
    removed: number;
    avgSeconds: number | null;
  };
  previous: { drafts: number; published: number } | null;
  bucketSize: "day" | "week";
  buckets: Bucket[];
  lengths: { label: string; count: number }[];
  tones: { label: string; count: number }[];
  posts: PublishedPost[];
  activity: ActivityItem[];
  history: { months: { month: string; label: string; count: number }[]; total: number; importedAt: string } | null;
  empty: boolean;
};

export async function buildReport(range: Range, now = new Date()): Promise<Report> {
  const days = range === "all" ? null : Number(range);
  const today = startOfDay(now);
  const since = days === null ? null : new Date(today.getTime() - (days - 1) * DAY);
  const previousSince = days === null || !since ? null : new Date(since.getTime() - days * DAY);

  // One read each; the previous period is only needed for the two headline counts.
  const generations = listGenerations(previousSince?.toISOString() ?? null);
  const events = listEvents(null);
  const inRange = (iso: string) => !since || iso >= since.toISOString();
  const inPrevious = (iso: string) =>
    !!previousSince && !!since && iso >= previousSince.toISOString() && iso < since.toISOString();

  const current = generations.filter((row) => inRange(row.started_at));
  const currentEvents = events.filter((event) => inRange(event.at));
  const finished = current.filter((row) => row.status === "done");
  const timed = finished.filter((row) => row.seconds !== null);
  const count = (type: EventRow["type"], list = currentEvents) => list.filter((event) => event.type === type).length;

  const totals = {
    drafts: finished.length,
    stopped: current.filter((row) => row.status === "stopped" || row.status === "running").length,
    failed: current.filter((row) => row.status === "failed").length,
    copied: count("draft_copied"),
    published: count("post_published"),
    removed: count("post_deleted"),
    avgSeconds: timed.length ? timed.reduce((sum, row) => sum + row.seconds!, 0) / timed.length : null,
  };

  const previous = previousSince
    ? {
        drafts: generations.filter((row) => row.status === "done" && inPrevious(row.started_at)).length,
        published: events.filter((event) => event.type === "post_published" && inPrevious(event.at)).length,
      }
    : null;

  // "All time" starts at the first thing the app recorded; long spans are grouped by week to stay readable.
  const firstRecord = [current[0]?.started_at, currentEvents[0]?.at].filter(Boolean).sort()[0];
  const chartStart = since ?? (firstRecord ? startOfDay(new Date(firstRecord)) : today);
  const spanDays = Math.round((today.getTime() - chartStart.getTime()) / DAY) + 1;
  const bucketSize = spanDays > 90 ? "week" : "day";
  const buckets = makeBuckets(chartStart, today, bucketSize);
  const bucketFor = (iso: string) => {
    const index = Math.floor((startOfDay(new Date(iso)).getTime() - chartStart.getTime()) / DAY / (bucketSize === "week" ? 7 : 1));
    return buckets[Math.min(Math.max(index, 0), buckets.length - 1)];
  };
  for (const row of finished) bucketFor(row.started_at).drafts++;
  for (const event of currentEvents) if (event.type === "post_published") bucketFor(event.at).published++;

  const inputs = finished.map((row) => parseInput(row.input));
  const lengths = tally(inputs.map((input) => input?.length ?? "not set"), ["short", "medium", "long", "not set"]);
  const tones = tally(
    inputs.map((input) => input?.tone?.trim().toLowerCase()).filter((tone): tone is string => !!tone),
  ).slice(0, 5);

  const deleted = new Set(events.filter((event) => event.type === "post_deleted").map((event) => event.data.urn));
  const posts = currentEvents
    .filter((event) => event.type === "post_published" && typeof event.data.urn === "string")
    .map((event) => ({
      urn: event.data.urn as string,
      url: typeof event.data.url === "string" ? event.data.url : `https://www.linkedin.com/feed/update/${event.data.urn}`,
      at: event.at,
      visibility: event.data.visibility === "CONNECTIONS" ? "Connections" : "Anyone",
      preview: typeof event.data.preview === "string" ? event.data.preview : "",
      characters: typeof event.data.characters === "number" ? event.data.characters : null,
      deleted: deleted.has(event.data.urn),
    }))
    .reverse();

  const activity = [
    ...current.map((row) => ({ at: row.started_at, text: generationText(row) })),
    ...currentEvents.map((event) => ({ at: event.at, text: eventText(event) })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 12);

  return {
    range,
    totals,
    previous,
    bucketSize,
    buckets,
    lengths,
    tones,
    posts,
    activity,
    history: await importedHistory(),
    empty: current.length === 0 && currentEvents.length === 0,
  };
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function makeBuckets(start: Date, end: Date, size: "day" | "week"): Bucket[] {
  const buckets: Bucket[] = [];
  const step = size === "week" ? 7 : 1;
  for (let day = new Date(start); day <= end; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + step)) {
    const label = day.toLocaleDateString("en", { month: "short", day: "numeric" });
    buckets.push({ start: day.toISOString(), label: size === "week" ? `Week of ${label}` : label, drafts: 0, published: 0 });
  }
  return buckets;
}

function parseInput(text: string): PostInput | null {
  try {
    return JSON.parse(text) as PostInput;
  } catch {
    return null;
  }
}

// Counts per label, most common first. `order` fixes the order instead (and keeps zero counts).
function tally(values: string[], order?: string[]): { label: string; count: number }[] {
  const counts = new Map<string, number>(order?.map((label) => [label, 0]));
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const rows = [...counts].map(([label, count]) => ({ label, count }));
  return order ? rows : rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function generationText(row: GenerationRow): string {
  const topic = parseInput(row.input)?.topic ?? "a post";
  const quoted = `“${topic.length > 60 ? `${topic.slice(0, 57)}…` : topic}”`;
  switch (row.status) {
    case "done":
      return `Generated a draft about ${quoted}`;
    case "failed":
      return `Generating ${quoted} failed`;
    default:
      return `Stopped generating ${quoted}`;
  }
}

function eventText(event: EventRow): string {
  switch (event.type) {
    case "post_published": {
      const count = typeof event.data.images === "number" ? event.data.images : 0;
      const details = `${event.data.visibility === "CONNECTIONS" ? "connections only" : "anyone"}${count ? `, ${count} image${count === 1 ? "" : "s"}` : ""}`;
      if (event.data.reason === "scheduled") return `A scheduled post went out (${details})`;
      if (event.data.reason === "autopilot") return `An automatic post went out (${details})`;
      return `Posted to LinkedIn (${details})`;
    }
    case "post_scheduled":
      return "Scheduled a post";
    case "image_generated":
      return "Generated an image";
    case "image_uploaded":
      return "Added an image";
    case "autopilot_ran":
      return event.data.posted
        ? "Automatic posting wrote and posted a post"
        : event.data.ok
          ? "Automatic posting wrote a draft"
          : "Automatic posting couldn't write a post";
    case "post_deleted":
      return "Deleted a post from LinkedIn";
    case "post_failed":
      return "A post to LinkedIn failed";
    case "draft_copied":
      return "Copied a draft";
    case "linkedin_connected":
      return event.data.posting ? "Enabled posting to LinkedIn" : "Connected LinkedIn";
    case "linkedin_disconnected":
      return "Disconnected LinkedIn";
    case "profile_saved":
      return "Saved the profile";
    case "profile_imported":
      return typeof event.data.posts === "number" && event.data.posts > 0
        ? `Imported LinkedIn data (${event.data.posts} past posts)`
        : "Imported LinkedIn data";
    case "prompt_saved":
      return "Changed the prompt";
    case "prompt_reset":
      return "Reset the prompt to the default";
  }
}

// Past posts from the imported LinkedIn data export, counted per month. The import keeps the newest 50.
async function importedHistory(): Promise<Report["history"]> {
  const profile = await readProfile().catch(() => null);
  if (!profile?.importedAt || profile.posts.length === 0) return null;
  const counts = new Map<string, number>();
  for (const post of profile.posts) {
    const month = post.date.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const months = [...counts.keys()].sort();
  // Fill gaps so quiet months show as zero instead of disappearing.
  const all: { month: string; label: string; count: number }[] = [];
  let [year, month] = months[0].split("-").map(Number);
  const [lastYear, lastMonth] = months.at(-1)!.split("-").map(Number);
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const label = new Date(year, month - 1, 1).toLocaleDateString("en", { month: "short", year: "numeric" });
    all.push({ month: key, label, count: counts.get(key) ?? 0 });
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return { months: all.slice(-24), total: profile.posts.length, importedAt: profile.importedAt };
}
