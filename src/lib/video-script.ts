// Server-only: writes a short video's script with the local model. Ollama's structured outputs keep the reply to
// the JSON schema below. The narration is asked for scene by scene, a sentence or two each, so the length is built up
// instead of the model having to count a long text; a script that still comes out short gets a repair pass that
// lengthens its shortest scenes. Other problems are sent back with the script, up to three times.
import { generateJson } from "./ollama.ts";
import type { VideoScene, VideoScript } from "./video-jobs.ts";
import { VIDEO_LENGTH, videoLength } from "./video-length.ts";
import { findSeries } from "./video-series.ts";

// The model that writes video scripts. Separate from OLLAMA_MODEL (posts), so each can be tuned on its own.
export const VIDEO_SCRIPT_MODEL = process.env.VIDEO_SCRIPT_MODEL?.trim() || "qwen3:4b";

// Moods match the background music folders (data/videos/music/<mood>/).
export const VIDEO_MOODS = ["calm", "upbeat", "inspiring", "dramatic", "playful", "mysterious"] as const;

export const NARRATION_WORDS = VIDEO_LENGTH.words;
const MAX_ATTEMPTS = 3;
// Repair passes per try for a narration that came out short.
const EXPAND_PASSES = 2;
// A script that's at most this much too short is still used when no try gets the length right.
const NEAR_MISS_SHORT = 0.1;

type Length = ReturnType<typeof videoLength>;

const schemaFor = (length: Length) => ({
  type: "object",
  properties: {
    title: { type: "string" },
    topic: { type: "string" },
    scenes: {
      type: "array",
      minItems: length.scenes.min,
      maxItems: length.scenes.max,
      items: {
        type: "object",
        properties: {
          narration: { type: "string" },
          image_prompt: { type: "string" },
          motion_prompt: { type: "string" },
          on_screen_text: { type: "string" },
        },
        required: ["narration", "image_prompt", "motion_prompt", "on_screen_text"],
      },
    },
    post_caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    mood: { type: "string", enum: [...VIDEO_MOODS] },
    style: { type: "string" },
  },
  required: ["title", "topic", "scenes", "post_caption", "hashtags", "mood", "style"],
});

type SceneWords = { min: number; target: number; max: number };

// The per-scene length for a narration of at most maxWords (shorter than usual when the spoken one ran long).
function sceneWordsFor(maxWords: number, length: Length): SceneWords {
  if (maxWords >= length.words.max) return length.sceneWords;
  const target = Math.max(5, Math.floor((maxWords * 0.9) / Math.round((length.scenes.min + length.scenes.max) / 2)));
  return { min: Math.max(4, target - 3), target, max: target + 2 };
}

function systemPrompt(length: Length, sceneWords: SceneWords, minWords: number, maxWords: number, tone: string): string {
  const SCENES = length.scenes;
  return `You write scripts for ${length.seconds}-second vertical videos (YouTube Shorts, Reels, TikTok).
Rules:
- scenes: ${SCENES.min} to ${SCENES.max}, in order. Read one after another, their narrations are the whole voice-over (${minWords} to ${maxWords} words in total).
  - narration: what the voice says during this scene: one or two full sentences, ${sceneWords.min} to ${sceneWords.max} words (aim for ${sceneWords.target}). Plain spoken English. The first scene is the hook. Each scene adds something new; don't repeat a point. No emojis, hashtags or stage directions.
  - image_prompt: one picture for an image generator showing what the narration says, under 60 words: subject, setting, composition, lighting. Vertical framing. No text, letters, logos or real people's names in the picture, and nothing that would have writing on it: no screens, phones, signs, books, papers or posters.
  - motion_prompt: how the picture moves for a few seconds, under 30 words: one gentle camera move (slow push-in, slow pan, slow pull-back) and one small natural movement of the subject or setting (hair or cloth in a breeze, rippling water, drifting clouds, flickering firelight, a slow turn of the head). Calm and subtle; no fast action or new objects appearing.
  - on_screen_text: a short caption shown over the scene, 2 to 6 words.
- title: under 60 characters.
- post_caption: one or two sentences to post with the video.
- hashtags: 3 to 5, each starting with #.
- mood: one of ${VIDEO_MOODS.join(", ")}, for the background music.
- style: a few words on the look, for example "retro PS2-era 3D render, low-poly, soft fog".
- Don't invent statistics, quotes or facts you're not sure of.
${tone ? `- Tone: ${tone}.\n` : ""}The script must be about the topic you're given.
Reply with the JSON only.`;
}

export type ScriptOptions = {
  model?: string;
  maxWords?: number;
  signal?: AbortSignal;
  skipGpuLease?: boolean;
  // Adds that series' rules (see video-series.ts) to the instructions.
  seriesId?: string | null;
  // This video's own settings (video-settings.ts): its length, voice speed, number of scenes and tone.
  seconds?: number;
  voiceSpeed?: number;
  scenes?: number | null;
  tone?: string;
};

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

type Draft = Partial<Omit<VideoScript, "scenes">> & { scenes?: Partial<VideoScene>[] };

function narrationOf(draft: Draft): string {
  return (draft.scenes ?? []).map((scene) => scene?.narration?.trim() ?? "").filter(Boolean).join(" ");
}

// What's wrong with a script, as sentences the model can act on. Empty when it's fine.
// `minWords` can be lowered for the near-miss check.
export function scriptProblems(
  script: unknown,
  maxWords = NARRATION_WORDS.max,
  minWords = Math.min(NARRATION_WORDS.min, maxWords - 4),
  length: Length = VIDEO_LENGTH,
): string[] {
  const SCENES = length.scenes;
  const problems: string[] = [];
  const value = script as Draft | null;
  if (!value || typeof value !== "object") return ["The reply wasn't a JSON object."];
  const text = (field: "title" | "post_caption" | "mood") => (typeof value[field] === "string" ? (value[field] as string).trim() : "");
  if (!text("title")) problems.push("title is missing.");
  else if (text("title").length > 80) problems.push("title is too long; keep it under 60 characters.");
  if (!Array.isArray(value.scenes) || value.scenes.length < SCENES.min || value.scenes.length > SCENES.max) {
    problems.push(`scenes must have ${SCENES.min} to ${SCENES.max} items.`);
  } else {
    value.scenes.forEach((scene, index) => {
      if (!scene?.narration?.trim()) problems.push(`scene ${index + 1} has no narration.`);
      if (!scene?.image_prompt?.trim()) problems.push(`scene ${index + 1} has no image_prompt.`);
      const caption = scene?.on_screen_text?.trim() ?? "";
      if (!caption) problems.push(`scene ${index + 1} has no on_screen_text.`);
      else if (wordCount(caption) > 8) problems.push(`scene ${index + 1}'s on_screen_text is too long; use 2 to 6 words.`);
    });
    const words = wordCount(narrationOf(value));
    if (words < minWords) {
      problems.push(`the scene narrations add up to ${words} words; together they must have ${minWords} to ${maxWords}. Make each scene's narration longer.`);
    } else if (words > maxWords) {
      problems.push(`the scene narrations add up to ${words} words; together they must have ${minWords} to ${maxWords}. Make each scene's narration shorter.`);
    }
  }
  if (!text("post_caption")) problems.push("post_caption is missing.");
  if (!Array.isArray(value.hashtags) || value.hashtags.length < 1) problems.push("add 3 to 5 hashtags.");
  if (!(VIDEO_MOODS as readonly string[]).includes(text("mood"))) problems.push(`mood must be one of ${VIDEO_MOODS.join(", ")}.`);
  return problems;
}

// Tidies small things the checks allow (spacing, hashtag signs) so the rest of the pipeline gets clean values, and
// joins the scene narrations into the narration the voice reads.
function tidy(script: Draft, topic: string): VideoScript {
  // Each scene's narration ends a sentence, so the joined narration reads (and is spoken) with its pauses.
  const sentence = (text: string) => (text && !/[.!?…"')\]]$/.test(text) ? `${text}.` : text);
  const scenes = (script.scenes ?? []).map((scene) => ({
    narration: sentence((scene.narration ?? "").replace(/\s+/g, " ").trim()),
    image_prompt: (scene.image_prompt ?? "").trim(),
    motion_prompt: (scene.motion_prompt ?? "").replace(/\s+/g, " ").trim(),
    on_screen_text: (scene.on_screen_text ?? "").trim(),
  }));
  return {
    title: (script.title ?? "").trim(),
    topic: script.topic?.trim() || topic,
    narration: scenes.map((scene) => scene.narration).join(" "),
    scenes,
    post_caption: (script.post_caption ?? "").trim(),
    hashtags: (script.hashtags ?? [])
      .map((tag) => `#${tag.replace(/^#+/, "").replace(/\s+/g, "")}`)
      .filter((tag) => tag.length > 1)
      .slice(0, 5),
    mood: script.mood ?? "calm",
    style: script.style?.trim() || "retro PS2-era 3D render",
  };
}

export type ScriptResult = { script: VideoScript; attempts: number; model: string; seconds: number };

export class ScriptError extends Error {
  attempts: number;

  constructor(message: string, attempts: number) {
    super(message);
    this.name = "ScriptError";
    this.attempts = attempts;
  }
}

export async function generateVideoScript(topic: string, options: ScriptOptions = {}): Promise<ScriptResult> {
  const model = options.model ?? VIDEO_SCRIPT_MODEL;
  const length = options.seconds || options.voiceSpeed || options.scenes ? videoLength(options.seconds, options.voiceSpeed, options.scenes) : VIDEO_LENGTH;
  const maxWords = Math.min(options.maxWords ?? length.words.max, length.words.max);
  const minWords = Math.min(length.words.min, maxWords - 4);
  const sceneWords = sceneWordsFor(maxWords, length);
  const started = Date.now();
  const series = findSeries(options.seriesId);
  const base = systemPrompt(length, sceneWords, minWords, maxWords, options.tone?.trim() ?? "");
  const SCHEMA = schemaFor(length);
  const system = series ? `${base}\n\n${series.scriptRules}` : base;
  const ask = <T>(prompt: string, schema: object) =>
    generateJson<T>(prompt, system, schema, { model, temperature: 0.7, signal: options.signal, skipGpuLease: options.skipGpuLease });
  const done = (draft: Draft, attempts: number): ScriptResult => ({
    script: tidy(draft, topic),
    attempts,
    model,
    seconds: (Date.now() - started) / 1000,
  });

  let feedback = "";
  let lastProblems: string[] = [];
  let nearMiss: Draft | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let draft: Draft;
    try {
      draft = await ask<Draft>(`Topic: ${topic}${feedback}`, SCHEMA);
    } catch (error) {
      if (options.signal?.aborted || !/valid JSON/.test((error as Error).message)) throw error;
      lastProblems = ["The reply wasn't valid JSON."];
      feedback = `\n\nYour last reply wasn't valid JSON. Reply with the JSON object only.`;
      continue;
    }
    for (let pass = 0; pass < EXPAND_PASSES && Array.isArray(draft.scenes) && wordCount(narrationOf(draft)) < minWords; pass++) {
      if (!(await expandScenes(draft, topic, sceneWords, ask, options.signal))) break;
    }
    lastProblems = scriptProblems(draft, maxWords, minWords, length);
    const quoted = series?.noQuotes === true && /["“”]/.test(narrationOf(draft));
    if (quoted) lastProblems.push("a narration has quotation marks; paraphrase instead of quoting (no direct quotes).");
    if (!lastProblems.length) return done(draft, attempt);
    if (!nearMiss && !quoted && !scriptProblems(draft, maxWords, Math.floor(minWords * (1 - NEAR_MISS_SHORT)), length).length) {
      nearMiss = draft;
    }
    feedback = `\n\nYour last reply had these problems; fix them:\n- ${lastProblems.join("\n- ")}`;
  }
  if (nearMiss) return done(nearMiss, MAX_ATTEMPTS);
  throw new ScriptError(`The script still had problems after ${MAX_ATTEMPTS} tries: ${lastProblems.join(" ")}`, MAX_ATTEMPTS);
}

const EXPAND_SCHEMA = {
  type: "object",
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: { scene: { type: "integer" }, narration: { type: "string" } },
        required: ["scene", "narration"],
      },
    },
  },
  required: ["scenes"],
};

// The repair pass: sends the script back asking for longer narrations in its shortest scenes, and puts the longer
// ones in place. Returns false when nothing got longer.
async function expandScenes(
  draft: Draft,
  topic: string,
  sceneWords: SceneWords,
  ask: <T>(prompt: string, schema: object) => Promise<T>,
  signal?: AbortSignal,
): Promise<boolean> {
  const scenes = draft.scenes ?? [];
  const short = scenes
    .map((scene, index) => ({ index, words: wordCount(scene?.narration ?? "") }))
    .filter((scene) => scene.words < sceneWords.target)
    .map((scene) => scene.index);
  if (!short.length) return false;
  const listing = scenes.map((scene, index) => `${index + 1}. (${wordCount(scene?.narration ?? "")} words) ${scene?.narration ?? ""}`).join("\n");
  const prompt = `Topic: ${topic}

This script's narration is too short. Its scenes, in order:
${listing}

Rewrite the narration of scenes ${short.map((index) => index + 1).join(", ")} so each has ${sceneWords.target} to ${sceneWords.max} words: keep what it says and add detail, a reason, or an everyday example. Don't repeat other scenes. Reply with JSON: {"scenes": [{"scene": <number>, "narration": "..."}]}`;
  let reply: { scenes?: { scene?: number; narration?: string }[] };
  try {
    reply = await ask(prompt, EXPAND_SCHEMA);
  } catch (error) {
    if (signal?.aborted) throw error;
    return false;
  }
  let changed = false;
  for (const item of reply.scenes ?? []) {
    const index = Number(item.scene) - 1;
    const scene = scenes[index];
    const narration = item.narration?.replace(/\s+/g, " ").trim() ?? "";
    if (scene && narration && wordCount(narration) > wordCount(scene.narration ?? "") && wordCount(narration) <= sceneWords.max + 8) {
      scene.narration = narration;
      changed = true;
    }
  }
  return changed;
}
