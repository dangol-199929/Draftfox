// How long the Video Studio's videos are. One setting, VIDEO_TARGET_SECONDS in .env (default 50), sets the
// narration length, the number of scenes and the length the quality check accepts. The Python worker reads the same
// setting (worker/draftfox_worker/length.py), so keep the two in step. In the browser .env isn't available, so the
// Video Studio's hints use the default.
const DEFAULT_SECONDS = 50;

// How fast the narrator speaks: about 2.4 words a second at speed 1.0, measured with Kokoro's bm_george, bm_lewis and
// am_michael voices (see DraftfoxHub/voice-samples/), scaled by VIDEO_VOICE_SPEED (default 0.9, as the worker uses).
function voiceSpeed(): number {
  const value = Number(typeof process === "undefined" ? undefined : process.env.VIDEO_VOICE_SPEED);
  return Number.isFinite(value) && value >= 0.5 && value <= 2 ? value : 0.9;
}
export const WORDS_PER_SECOND = 2.4 * voiceSpeed();

function targetSeconds(): number {
  const value = Number(typeof process === "undefined" ? undefined : process.env.VIDEO_TARGET_SECONDS);
  return Number.isFinite(value) && value >= 8 && value <= 90 ? value : DEFAULT_SECONDS;
}

export function videoLength(seconds = targetSeconds()) {
  // The narration fills the video except for a short lead-in and tail.
  const spoken = seconds - 1.5;
  const words = {
    min: Math.round(spoken * WORDS_PER_SECOND * 0.88),
    target: Math.round(spoken * WORDS_PER_SECOND),
    max: Math.round(spoken * WORDS_PER_SECOND * 1.12),
  };
  // One scene for every 4-6 seconds: 8-12 scenes for 50 s.
  const scenes = { min: Math.max(2, Math.round(seconds / 6)), max: Math.max(3, Math.floor(seconds / 4)) };
  // Each scene's narration, so the model builds the length up scene by scene instead of counting the whole.
  const middleScenes = Math.round((scenes.min + scenes.max) / 2);
  const perScene = Math.round(words.target / middleScenes);
  const margin = Math.round(seconds * 0.24);
  return {
    seconds,
    words,
    scenes,
    sceneWords: { min: Math.max(6, perScene - 3), target: perScene, max: perScene + 4 },
    // The longest the narration may be once spoken, and what the quality check accepts (38-62 s for 50 s).
    maxSpokenSeconds: seconds + Math.round(seconds * 0.18),
    check: { min: seconds - margin, max: seconds + margin },
  };
}

export const VIDEO_LENGTH = videoLength();
