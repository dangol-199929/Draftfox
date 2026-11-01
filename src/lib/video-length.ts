// How long the Video Studio's videos are. One setting, VIDEO_TARGET_SECONDS in .env (default 25), sets the
// narration length, the number of scenes and the length the quality check accepts. The Python worker reads the same
// setting (worker/draftfox_worker/length.py), so keep the two in step. In the browser .env isn't available, so the
// Video Studio's hints use the default.
const DEFAULT_SECONDS = 25;

function targetSeconds(): number {
  const value = Number(typeof process === "undefined" ? undefined : process.env.VIDEO_TARGET_SECONDS);
  return Number.isFinite(value) && value >= 8 && value <= 60 ? value : DEFAULT_SECONDS;
}

export function videoLength(seconds = targetSeconds()) {
  const scenesMin = Math.max(2, Math.round(seconds / 5));
  return {
    seconds,
    // Spoken at about 2.6 words a second, with room for pauses: 55-75 words for 25 s.
    words: { min: Math.round(seconds * 2.2), max: Math.round(seconds * 3) },
    // 5-7 scenes for 25 s, so each picture stays on screen for 3-5 s.
    scenes: { min: scenesMin, max: scenesMin + 2 },
    // The longest the narration may be once spoken, and what the quality check accepts (18-32 s for 25 s).
    maxSpokenSeconds: seconds + 5,
    check: { min: seconds - 7, max: seconds + 7 },
  };
}

export const VIDEO_LENGTH = videoLength();
