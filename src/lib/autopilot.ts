// Server-only: automatic posting. On a schedule (daily, every 3 days or weekly) it writes a post about the next
// topic in your list, optionally with an image, and either saves it as a draft for you to review or posts it.
import { randomUUID } from "node:crypto";
import { insertPost, logEvent, readSetting, writeSetting, type PostRecord } from "./db.ts";
import { CARTOON_SIZE, PALETTES, cartoonPrompt, renderCard, writeCardContent, type Palette } from "./card.tsx";
import { generateImage, readImage, saveImage } from "./images.ts";
import { generateLinkedInPost } from "./post.ts";
import type { PostInput } from "./prompts.ts";
import { publishPost } from "./publish.ts";

export const FREQUENCIES = { daily: 1, every3days: 3, weekly: 7 } as const;
export type Frequency = keyof typeof FREQUENCIES;

export type AutopilotSettings = {
  enabled: boolean;
  frequency: Frequency;
  // Local time of day, "HH:MM".
  time: string;
  topics: string[];
  audience: string;
  tone: string;
  length: NonNullable<PostInput["length"]>;
  // Adds a designed card (hook, key points and a cartoon) to each post.
  withImage: boolean;
  cardPalette: Palette;
  // "review": save a draft for you to approve. "auto": post it right away.
  mode: "review" | "auto";
  visibility: "PUBLIC" | "CONNECTIONS";
};

export type AutopilotState = {
  nextTopic: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastResult: string | null;
  lastPostId: string | null;
};

export const DEFAULT_SETTINGS: AutopilotSettings = {
  enabled: false,
  frequency: "daily",
  time: "09:00",
  topics: [],
  audience: "",
  tone: "",
  length: "medium",
  withImage: false,
  cardPalette: "cream",
  mode: "review",
  visibility: "PUBLIC",
};

const DEFAULT_STATE: AutopilotState = { nextTopic: 0, nextRunAt: null, lastRunAt: null, lastResult: null, lastPostId: null };

// A run that's this late (the app or the Mac was off at the time) still happens; later than this it's skipped.
export const LATE_LIMIT = 12 * 60 * 60 * 1000;

export function readAutopilot(): { settings: AutopilotSettings; state: AutopilotState } {
  return {
    settings: { ...DEFAULT_SETTINGS, ...readSetting<Partial<AutopilotSettings>>("autopilot") },
    state: { ...DEFAULT_STATE, ...readSetting<Partial<AutopilotState>>("autopilot_state") },
  };
}

function saveState(state: AutopilotState) {
  writeSetting("autopilot_state", state);
}

// Returns the cleaned settings, or an error message naming the bad field.
export function validateSettings(body: unknown): AutopilotSettings | string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "Settings must be a JSON object.";
  const data = { ...DEFAULT_SETTINGS, ...(body as Partial<AutopilotSettings>) };
  if (typeof data.enabled !== "boolean") return `"enabled" must be true or false.`;
  if (!(data.frequency in FREQUENCIES)) return `"frequency" must be one of: ${Object.keys(FREQUENCIES).join(", ")}.`;
  if (typeof data.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.time)) return `"time" must look like 09:00.`;
  if (!Array.isArray(data.topics) || data.topics.some((topic) => typeof topic !== "string")) {
    return `"topics" must be a list of strings.`;
  }
  const topics = data.topics.map((topic) => topic.trim()).filter(Boolean).slice(0, 100);
  if (topics.some((topic) => topic.length > 500)) return "Each topic must be at most 500 characters.";
  if (data.enabled && topics.length === 0) return "Add at least one topic before turning on automatic posting.";
  for (const field of ["audience", "tone"] as const) {
    if (typeof data[field] !== "string" || data[field].length > 200) return `"${field}" must be at most 200 characters.`;
  }
  if (!["short", "medium", "long"].includes(data.length)) return `"length" must be short, medium or long.`;
  if (typeof data.withImage !== "boolean") return `"withImage" must be true or false.`;
  if (!(data.cardPalette in PALETTES)) return `"cardPalette" must be one of: ${Object.keys(PALETTES).join(", ")}.`;
  if (!["review", "auto"].includes(data.mode)) return `"mode" must be review or auto.`;
  if (!["PUBLIC", "CONNECTIONS"].includes(data.visibility)) return `"visibility" must be PUBLIC or CONNECTIONS.`;
  return {
    enabled: data.enabled,
    frequency: data.frequency,
    time: data.time,
    topics,
    audience: data.audience.trim(),
    tone: data.tone.trim(),
    length: data.length,
    withImage: data.withImage,
    cardPalette: data.cardPalette,
    mode: data.mode,
    visibility: data.visibility,
  };
}

export function saveAutopilot(settings: AutopilotSettings): { settings: AutopilotSettings; state: AutopilotState } {
  const { settings: before, state } = readAutopilot();
  writeSetting("autopilot", settings);
  const scheduleChanged =
    before.enabled !== settings.enabled || before.time !== settings.time || before.frequency !== settings.frequency;
  const next: AutopilotState = {
    ...state,
    // Edited topics may be fewer than before; start over at the top if the position fell off the end.
    nextTopic: state.nextTopic < settings.topics.length ? state.nextTopic : 0,
    nextRunAt: !settings.enabled ? null : scheduleChanged || !state.nextRunAt ? firstRun(settings.time) : state.nextRunAt,
  };
  saveState(next);
  return { settings, state: next };
}

// The next time the clock shows `time` (today if it's still ahead, otherwise tomorrow).
export function firstRun(time: string, now = new Date()): string {
  const [hours, minutes] = time.split(":").map(Number);
  const run = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
  if (run.getTime() <= now.getTime()) run.setDate(run.getDate() + 1);
  return run.toISOString();
}

// Moves forward by whole periods until the run is in the future, keeping the time of day.
export function followingRun(previous: string, frequency: Frequency, now = new Date()): string {
  const run = new Date(previous);
  do run.setDate(run.getDate() + FREQUENCIES[frequency]);
  while (run.getTime() <= now.getTime());
  return run.toISOString();
}

// On globalThis so the scheduler and a click on Write one now share it, even across dev hot reloads.
const flags = globalThis as typeof globalThis & { autopilotRunning?: boolean };

// Called by the scheduler every minute. Runs when the next run time has come, unless it's too late.
export async function autopilotTick(now = new Date()): Promise<void> {
  const { settings, state } = readAutopilot();
  if (!settings.enabled || !state.nextRunAt || flags.autopilotRunning) return;
  const due = Date.parse(state.nextRunAt);
  if (due > now.getTime()) return;

  const nextRunAt = followingRun(state.nextRunAt, settings.frequency, now);
  if (now.getTime() - due > LATE_LIMIT) {
    saveState({ ...state, nextRunAt, lastResult: "Skipped a run because the app wasn't running at the time." });
    return;
  }
  // Move the schedule on before the slow part, so a crash or restart doesn't run it twice.
  saveState({ ...state, nextRunAt });
  await runAutopilot(settings, "schedule");
}

// Writes one post now. `trigger` "manual" (the Write one now button) always saves a draft, even in auto mode.
export async function runAutopilot(
  settings: AutopilotSettings,
  trigger: "schedule" | "manual",
): Promise<{ post: PostRecord | null; result: string }> {
  if (flags.autopilotRunning) return { post: null, result: "Automatic posting is already writing a post." };
  flags.autopilotRunning = true;
  const state = readAutopilot().state;
  const topicIndex = state.nextTopic % Math.max(settings.topics.length, 1);
  const topic = settings.topics[topicIndex];
  const finish = (result: string, post: PostRecord | null, advance: boolean) => {
    const latest = readAutopilot().state;
    saveState({
      ...latest,
      nextTopic: advance ? (topicIndex + 1) % settings.topics.length : latest.nextTopic,
      lastRunAt: new Date().toISOString(),
      lastResult: result,
      lastPostId: post?.id ?? latest.lastPostId,
    });
    logEvent("autopilot_ran", { trigger, ok: post !== null, posted: post?.status === "posted" });
    return { post, result };
  };

  try {
    if (!topic) return finish("No topics to write about. Add some topics.", null, false);
    const text = (
      await generateLinkedInPost({
        topic,
        audience: settings.audience || undefined,
        tone: settings.tone || undefined,
        length: settings.length,
      })
    ).trim();
    if (!text) return finish(`The model returned nothing for "${topic}".`, null, false);

    const notes: string[] = [];
    const needsContext = text.startsWith("NEED MORE CONTEXT:");
    const images: PostRecord["images"] = [];
    if (settings.withImage && !needsContext) {
      try {
        images.push(await makeCard(text, settings.cardPalette));
      } catch (error) {
        notes.push(`no image (${(error as Error).message})`);
      }
    }

    const now = new Date().toISOString();
    const post: PostRecord = {
      id: randomUUID(),
      text,
      images,
      visibility: settings.visibility,
      status: "draft",
      source: "autopilot",
      topic,
      scheduledAt: null,
      postedAt: null,
      urn: null,
      url: null,
      error: needsContext ? "The model asked for more context instead of writing a post. Add details, then post it." : null,
      createdAt: now,
      updatedAt: now,
    };
    insertPost(post);

    if (needsContext) return finish(`"${topic}" needs more context, so it was saved as a draft.`, post, true);
    if (settings.mode === "auto" && trigger === "schedule") {
      try {
        const posted = await publishPost(post.id, "draft", "autopilot");
        return finish(`Posted "${topic}" to LinkedIn${notes.length ? `, ${notes.join(", ")}` : ""}.`, posted, true);
      } catch (error) {
        return finish(`Wrote "${topic}" but posting failed: ${(error as Error).message}`, post, true);
      }
    }
    return finish(`Saved a draft about "${topic}" for you to review${notes.length ? `, ${notes.join(", ")}` : ""}.`, post, true);
  } catch (error) {
    console.error("Automatic posting failed:", error);
    return finish(`Couldn't write a post: ${(error as Error).message}`, null, false);
  } finally {
    flags.autopilotRunning = false;
  }
}

// Writes the card text from the post, draws the cartoon, lays out the card and saves it. Without a cartoon
// (the image engine isn't set up), the card is still made with text only.
async function makeCard(text: string, palette: Palette): Promise<PostRecord["images"][number]> {
  const content = await writeCardContent(text);
  let illustration: { data: Buffer; mime: string } | null = null;
  if (content.illustration) {
    try {
      const cartoon = await generateImage(cartoonPrompt(content.illustration), CARTOON_SIZE.portrait);
      const file = await readImage(cartoon.id);
      if (file) illustration = { data: file.data, mime: file.record.mime };
    } catch (error) {
      console.error("Automatic posting: no cartoon for the card:", (error as Error).message);
    }
  }
  const png = await renderCard({ content, palette, layout: "portrait", illustration });
  const card = await saveImage(png, "image/png", "generated", content.hook);
  return { id: card.id, alt: [content.hook.replace(/\*/g, ""), ...content.points].join(". ").slice(0, 1000) };
}
