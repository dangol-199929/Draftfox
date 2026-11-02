// A video's own settings: voice, length, motion, look, captions, music and prompt extras. Chosen when a video is
// added (starting from your saved defaults) and kept in its assets.settings, where the worker reads them; anything
// missing falls back to .env (VIDEO_VOICE and friends). Safe to import in the browser.

export const VIDEO_VOICES = [
  // Male voices with samples in DraftfoxHub/voice-samples (at speeds 0.9 and 1.0).
  { id: "bm_george", label: "George (British)", sample: true },
  { id: "bm_lewis", label: "Lewis (British)", sample: true },
  { id: "bm_fable", label: "Fable (British)", sample: true },
  { id: "am_michael", label: "Michael (American)", sample: true },
  { id: "am_onyx", label: "Onyx (American)", sample: true },
  { id: "am_fenrir", label: "Fenrir (American)", sample: true },
  // More Kokoro voices, without samples yet.
  { id: "bm_daniel", label: "Daniel (British)", sample: false },
  { id: "am_adam", label: "Adam (American)", sample: false },
  { id: "am_eric", label: "Eric (American)", sample: false },
  { id: "am_liam", label: "Liam (American)", sample: false },
  { id: "af_heart", label: "Heart (American, female)", sample: false },
  { id: "af_bella", label: "Bella (American, female)", sample: false },
  { id: "bf_emma", label: "Emma (British, female)", sample: false },
  { id: "bf_isabella", label: "Isabella (British, female)", sample: false },
] as const;

export const VIDEO_SECONDS = [30, 45, 50, 60] as const;
export const MUSIC_MOODS = ["calm", "upbeat", "inspiring", "dramatic", "playful", "mysterious"] as const;
export const RETRO_LEVELS = ["off", "light", "normal", "strong"] as const;
export const CAPTION_SIZES = ["small", "medium", "large"] as const;
export const CAPTION_POSITIONS = ["top", "middle", "bottom"] as const;

export type VideoSettings = {
  voice: string;
  voiceSpeed: number;
  seconds: number;
  // null lets the script writer pick (one scene every 4-6 seconds).
  scenes: number | null;
  motion: boolean;
  motionStrength: "subtle" | "normal";
  retro: (typeof RETRO_LEVELS)[number];
  captions: boolean;
  captionSize: (typeof CAPTION_SIZES)[number];
  captionPosition: (typeof CAPTION_POSITIONS)[number];
  captionColor: string;
  captionWords: number;
  // "auto" uses the mood the script picked.
  music: "auto" | "none" | (typeof MUSIC_MOODS)[number];
  musicVolume: number;
  imageStyle: string;
  scriptTone: string;
  pauseAfterScript: boolean;
};

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  voice: "bm_george",
  voiceSpeed: 0.9,
  seconds: 50,
  scenes: null,
  motion: true,
  motionStrength: "normal",
  retro: "normal",
  captions: true,
  captionSize: "medium",
  captionPosition: "bottom",
  captionColor: "#FFFFFF",
  captionWords: 3,
  music: "auto",
  musicVolume: 12,
  imageStyle: "",
  scriptTone: "",
  pauseAfterScript: false,
};

const pick = <T,>(value: unknown, options: readonly T[], fallback: T): T =>
  (options as readonly unknown[]).includes(value) ? (value as T) : fallback;
const number = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
const text = (value: unknown, max: number, fallback: string) => (typeof value === "string" ? value.trim().slice(0, max) : fallback);

// Keeps only valid values, filling the rest from `base`.
export function normalizeVideoSettings(input: unknown, base: VideoSettings = DEFAULT_VIDEO_SETTINGS): VideoSettings {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const scenes = value.scenes === null || value.scenes === "" ? null : number(value.scenes, 2, 15, base.scenes ?? NaN);
  return {
    voice: /^[a-z]{2}_[a-z]+$/.test(String(value.voice)) ? String(value.voice) : base.voice,
    voiceSpeed: Math.round(number(value.voiceSpeed, 0.8, 1.1, base.voiceSpeed) * 100) / 100,
    seconds: (VIDEO_SECONDS as readonly number[]).includes(Number(value.seconds)) ? Number(value.seconds) : base.seconds,
    scenes: Number.isFinite(scenes) ? Math.round(scenes as number) : null,
    motion: typeof value.motion === "boolean" ? value.motion : base.motion,
    motionStrength: pick(value.motionStrength, ["subtle", "normal"] as const, base.motionStrength),
    retro: pick(value.retro, RETRO_LEVELS, base.retro),
    captions: typeof value.captions === "boolean" ? value.captions : base.captions,
    captionSize: pick(value.captionSize, CAPTION_SIZES, base.captionSize),
    captionPosition: pick(value.captionPosition, CAPTION_POSITIONS, base.captionPosition),
    captionColor: /^#[0-9a-f]{6}$/i.test(String(value.captionColor)) ? String(value.captionColor).toUpperCase() : base.captionColor,
    captionWords: Math.round(number(value.captionWords, 1, 4, base.captionWords)),
    music: pick(value.music, ["auto", "none", ...MUSIC_MOODS] as const, base.music),
    musicVolume: Math.round(number(value.musicVolume, 0, 40, base.musicVolume)),
    imageStyle: text(value.imageStyle, 300, base.imageStyle),
    scriptTone: text(value.scriptTone, 300, base.scriptTone),
    pauseAfterScript: typeof value.pauseAfterScript === "boolean" ? value.pauseAfterScript : base.pauseAfterScript,
  };
}

// What has to be made again for a settings change to show, earliest first.
export function settingsRedo(before: VideoSettings, after: VideoSettings): "script" | "clips" | "audio" | "render" | null {
  const changed = (keys: (keyof VideoSettings)[]) => keys.some((key) => before[key] !== after[key]);
  if (changed(["seconds", "scenes", "scriptTone"])) return "script";
  if (changed(["motion", "motionStrength"])) return "clips";
  if (changed(["voice", "voiceSpeed", "captionWords"])) return "audio";
  if (changed(["retro", "captions", "captionSize", "captionPosition", "captionColor", "music", "musicVolume"])) return "render";
  return null;
}
