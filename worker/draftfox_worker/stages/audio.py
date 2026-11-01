"""Audio stage: the narration spoken by Kokoro (on the CPU), word timings from faster-whisper, and captions as an
ASS subtitle file showing 2-3 words at a time. Narration longer than MAX_SECONDS is sped up a little, then
rewritten shorter by the script model."""

from __future__ import annotations

import logging
import re
import time
from pathlib import Path
from typing import Any

from ..context import StageContext, StageError
from .script import write_script

log = logging.getLogger("worker.audio")

SAMPLE_RATE = 24000
MAX_SECONDS = 12.0
SPEEDS = (1.0, 1.1, 1.2)
REWRITES = 2

_pipelines: dict[str, Any] = {}
_whisper: Any = None


def _pipeline(lang: str) -> Any:
    if lang not in _pipelines:
        from kokoro import KPipeline  # imported here: slow, and only this stage needs it

        _pipelines[lang] = KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M")
    return _pipelines[lang]


def speak(text: str, voice: str, speed: float, out: Path) -> float:
    import numpy as np
    import soundfile

    pipeline = _pipeline(voice[0])  # Kokoro voices start with their language code: "a" is American English
    chunks = [audio.numpy() if hasattr(audio, "numpy") else audio for _, _, audio in pipeline(text, voice=voice, speed=speed)]
    if not chunks:
        raise StageError("Kokoro made no audio for the narration.")
    audio = np.concatenate(chunks)
    soundfile.write(out, audio, SAMPLE_RATE)
    return len(audio) / SAMPLE_RATE


def word_timings(wav: Path, model_name: str) -> list[dict[str, Any]]:
    global _whisper
    import numpy as np
    import soundfile
    from faster_whisper import WhisperModel

    if _whisper is None:
        _whisper = WhisperModel(model_name, device="cpu", compute_type="int8")
    # Whisper wants 16 kHz mono floats. Passing the samples (not the path) also skips faster-whisper's own
    # decoder, which doesn't work with the PyAV version installed.
    audio, rate = soundfile.read(wav, dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    if rate != 16000:
        positions = np.arange(0, len(audio), rate / 16000)
        audio = np.interp(positions, np.arange(len(audio)), audio).astype(np.float32)
    segments, _ = _whisper.transcribe(audio, language="en", word_timestamps=True, vad_filter=False)
    return [{"word": w.word.strip(), "start": float(w.start), "end": float(w.end)} for s in segments for w in (s.words or [])]


def align(narration: str, heard: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Uses the script's own words (correct spelling) with Whisper's timings when the counts match."""
    words = narration.split()
    if len(words) == len(heard):
        return [{**timing, "word": word} for word, timing in zip(words, heard)]
    return heard


def _ass_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{int(hours)}:{int(minutes):02d}:{secs:05.2f}"


def _escape(text: str) -> str:
    return text.replace("\\", "/").replace("{", "(").replace("}", ")")


def caption_groups(words: list[dict[str, Any]], size: int = 3) -> list[dict[str, Any]]:
    """2-3 words per caption, ending a group early after punctuation."""
    groups: list[list[dict[str, Any]]] = [[]]
    for word in words:
        groups[-1].append(word)
        if len(groups[-1]) >= size or (len(groups[-1]) >= 2 and re.search(r"[.,!?;:]$", word["word"])):
            groups.append([])
    groups = [group for group in groups if group]
    # A lone last word joins the group before it.
    if len(groups) > 1 and len(groups[-1]) == 1:
        groups[-2].extend(groups.pop())
    result = []
    for index, group in enumerate(groups):
        end = groups[index + 1][0]["start"] if index + 1 < len(groups) else group[-1]["end"] + 0.3
        result.append({"text": " ".join(w["word"] for w in group), "start": group[0]["start"], "end": max(end, group[0]["start"] + 0.3)})
    return result


def write_ass(groups: list[dict[str, Any]], out: Path) -> None:
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial Black,92,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,3,2,80,80,520,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = [
        f"Dialogue: 0,{_ass_time(g['start'])},{_ass_time(g['end'])},Caption,,0,0,0,,{_escape(g['text'].upper())}" for g in groups
    ]
    out.write_text(header + "\n".join(lines) + "\n", encoding="utf-8")


def run(ctx: StageContext) -> dict[str, Any]:
    script = dict(ctx.job.get("script") or {})
    narration = script.get("narration", "").strip()
    if not narration:
        raise StageError("The script has no narration.", retryable=False)
    voice = ctx.config.get("VIDEO_VOICE", "af_heart")
    whisper_model = ctx.config.get("VIDEO_WHISPER_MODEL", "base.en")
    wav = ctx.dir / "narration.wav"

    started = time.monotonic()
    seconds = 0.0
    speed = SPEEDS[0]
    rewrites = 0
    while True:
        for speed in SPEEDS:
            ctx.progress(0.1, f"Speaking the narration with {voice} at {speed:.1f}x")
            seconds = speak(narration, voice, speed, wav)
            if seconds <= MAX_SECONDS:
                break
        if seconds <= MAX_SECONDS:
            break
        if rewrites >= REWRITES:
            raise StageError(f"The narration is still {seconds:.1f} s after {REWRITES} rewrites (limit {MAX_SECONDS:.0f} s).")
        rewrites += 1
        words = len(narration.split())
        max_words = max(14, int(words * (MAX_SECONDS - 0.5) / seconds))
        log.info("Narration is %.1f s at %.1fx; asking for at most %d words", seconds, speed, max_words)
        # Only the narration is replaced; the scenes (and their images) stay.
        narration = write_script(ctx, max_words=max_words)["narration"]
        script["narration"] = narration
    speak_seconds = time.monotonic() - started
    ctx.save_asset("narration", wav)

    ctx.progress(0.7, "Timing the captions")
    started = time.monotonic()
    words = align(narration, word_timings(wav, whisper_model))
    if not words:
        raise StageError("Whisper found no words in the narration audio.")
    ass = ctx.dir / "captions.ass"
    groups = caption_groups(words)
    write_ass(groups, ass)
    ctx.save_asset("captions", ass)
    ctx.progress(1, f"Narration {seconds:.1f} s, {len(words)} words timed")
    return {
        "script": script,
        "assets": {
            "narration_seconds": round(seconds, 2),
            "narration_speed": speed,
            "voice": voice,
            "words": words,
            # The render stage writes the captions from these, so edits made in the Video Studio show up.
            "caption_groups": [{**g, "start": round(g["start"], 2), "end": round(g["end"], 2)} for g in groups],
            "audio_timings": {"tts": round(speak_seconds, 1), "captions": round(time.monotonic() - started, 1)},
        },
    }
