// Server-only: writes a short video's script with the local model. Ollama's structured outputs keep the reply to
// the JSON schema below; the result is then checked (narration length, scene count...) and asked for again, with
// what was wrong, up to three times.
import { generateJson } from "./ollama.ts";
import type { VideoScript } from "./video-jobs.ts";

// The model that writes video scripts. Separate from OLLAMA_MODEL (posts), so each can be tuned on its own.
export const VIDEO_SCRIPT_MODEL = process.env.VIDEO_SCRIPT_MODEL?.trim() || "qwen3:4b";

// Moods match the background music folders (data/videos/music/<mood>/).
export const VIDEO_MOODS = ["calm", "upbeat", "inspiring", "dramatic", "playful", "mysterious"] as const;

export const NARRATION_WORDS = { min: 22, max: 30 };
const MAX_ATTEMPTS = 3;

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    topic: { type: "string" },
    narration: { type: "string" },
    scenes: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        properties: { image_prompt: { type: "string" }, on_screen_text: { type: "string" } },
        required: ["image_prompt", "on_screen_text"],
      },
    },
    post_caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    mood: { type: "string", enum: [...VIDEO_MOODS] },
    style: { type: "string" },
  },
  required: ["title", "topic", "narration", "scenes", "post_caption", "hashtags", "mood", "style"],
};

const SYSTEM = `You write scripts for 10-second vertical videos (YouTube Shorts, Reels, TikTok).
Rules:
- narration: what the voice says, ${NARRATION_WORDS.min} to ${NARRATION_WORDS.max} words, about 10 seconds spoken. Plain spoken English, one clear idea, a hook in the first words. No emojis, hashtags or stage directions.
- scenes: 2 or 3, shown in order while the narration plays.
  - image_prompt: one picture for an image generator, under 60 words: subject, setting, composition, lighting. Vertical framing. No text, letters, logos or real people's names in the picture.
  - on_screen_text: a short caption shown over the scene, 2 to 6 words.
- title: under 60 characters.
- post_caption: one or two sentences to post with the video.
- hashtags: 3 to 5, each starting with #.
- mood: one of ${VIDEO_MOODS.join(", ")}, for the background music.
- style: a few words on the look, for example "retro PS2-era 3D render, low-poly, soft fog".
- Don't invent statistics, quotes or facts you're not sure of.
Example narration (26 words): "Your brain sorts the whole day while you sleep. Skip it, and tomorrow's bugs get much harder to spot. Rest is part of the work."
Reply with the JSON only.`;

export type ScriptOptions = { model?: string; maxWords?: number; signal?: AbortSignal; skipGpuLease?: boolean };

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// What's wrong with a script, as sentences the model can act on. Empty when it's fine.
export function scriptProblems(script: unknown, maxWords = NARRATION_WORDS.max): string[] {
  const problems: string[] = [];
  const value = script as Partial<VideoScript> | null;
  if (!value || typeof value !== "object") return ["The reply wasn't a JSON object."];
  const text = (field: keyof VideoScript) => (typeof value[field] === "string" ? (value[field] as string).trim() : "");
  if (!text("title")) problems.push("title is missing.");
  else if (text("title").length > 80) problems.push("title is too long; keep it under 60 characters.");
  const words = wordCount(text("narration"));
  const minWords = Math.min(NARRATION_WORDS.min, maxWords - 4);
  if (words < minWords) {
    problems.push(`narration has ${words} words; it must have ${minWords} to ${maxWords}. Add about ${Math.ceil((minWords + maxWords) / 2) - words} words.`);
  } else if (words > maxWords) {
    problems.push(`narration has ${words} words; it must have ${minWords} to ${maxWords}. Remove about ${words - Math.floor((minWords + maxWords) / 2)} words.`);
  }
  if (!Array.isArray(value.scenes) || value.scenes.length < 2 || value.scenes.length > 3) {
    problems.push("scenes must have 2 or 3 items.");
  } else {
    value.scenes.forEach((scene, index) => {
      if (!scene?.image_prompt?.trim()) problems.push(`scene ${index + 1} has no image_prompt.`);
      const caption = scene?.on_screen_text?.trim() ?? "";
      if (!caption) problems.push(`scene ${index + 1} has no on_screen_text.`);
      else if (wordCount(caption) > 8) problems.push(`scene ${index + 1}'s on_screen_text is too long; use 2 to 6 words.`);
    });
  }
  if (!text("post_caption")) problems.push("post_caption is missing.");
  if (!Array.isArray(value.hashtags) || value.hashtags.length < 1) problems.push("add 3 to 5 hashtags.");
  if (!(VIDEO_MOODS as readonly string[]).includes(text("mood"))) problems.push(`mood must be one of ${VIDEO_MOODS.join(", ")}.`);
  return problems;
}

// Tidies small things the checks allow (spacing, hashtag signs) so the rest of the pipeline gets clean values.
function tidy(script: VideoScript, topic: string): VideoScript {
  return {
    title: script.title.trim(),
    topic: script.topic?.trim() || topic,
    narration: script.narration.replace(/\s+/g, " ").trim(),
    scenes: script.scenes.map((scene) => ({ image_prompt: scene.image_prompt.trim(), on_screen_text: scene.on_screen_text.trim() })),
    post_caption: script.post_caption.trim(),
    hashtags: script.hashtags
      .map((tag) => `#${tag.replace(/^#+/, "").replace(/\s+/g, "")}`)
      .filter((tag) => tag.length > 1)
      .slice(0, 5),
    mood: script.mood,
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
  const maxWords = options.maxWords ?? NARRATION_WORDS.max;
  const started = Date.now();
  let feedback = "";
  let lastProblems: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt = `Topic: ${topic}${maxWords < NARRATION_WORDS.max ? `\nThe narration must be at most ${maxWords} words.` : ""}${feedback}`;
    let reply: unknown;
    try {
      reply = await generateJson<unknown>(prompt, SYSTEM, SCHEMA, {
        model,
        temperature: 0.7,
        signal: options.signal,
        skipGpuLease: options.skipGpuLease,
      });
    } catch (error) {
      if (options.signal?.aborted || !/valid JSON/.test((error as Error).message)) throw error;
      lastProblems = ["The reply wasn't valid JSON."];
      feedback = `\n\nYour last reply wasn't valid JSON. Reply with the JSON object only.`;
      continue;
    }
    lastProblems = scriptProblems(reply, maxWords);
    if (!lastProblems.length) {
      return { script: tidy(reply as VideoScript, topic), attempts: attempt, model, seconds: (Date.now() - started) / 1000 };
    }
    feedback = `\n\nYour last reply had these problems; fix them:\n- ${lastProblems.join("\n- ")}`;
  }
  throw new ScriptError(`The script still had problems after ${MAX_ATTEMPTS} tries: ${lastProblems.join(" ")}`, MAX_ATTEMPTS);
}
