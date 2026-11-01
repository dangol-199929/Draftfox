"""How long the videos are, from VIDEO_TARGET_SECONDS (default 25), the same setting Draftfox uses to write the
scripts (src/lib/video-length.ts; keep the two in step)."""

from __future__ import annotations

from dataclasses import dataclass

from .config import Config

DEFAULT_SECONDS = 25.0


@dataclass(frozen=True)
class VideoLength:
    seconds: float
    # The longest the narration may be once spoken; longer is sped up, then rewritten.
    max_spoken: float
    # The rendered video is at least this long (music fills the end) and at most render_max.
    render_min: float
    render_max: float
    # What the quality check accepts.
    check_min: float
    check_max: float
    # The fewest words a rewritten (shorter) narration may have.
    min_words: int


def video_length(config: Config) -> VideoLength:
    try:
        seconds = float(config.get("VIDEO_TARGET_SECONDS", str(DEFAULT_SECONDS)))
    except ValueError:
        seconds = DEFAULT_SECONDS
    if not 8 <= seconds <= 60:
        seconds = DEFAULT_SECONDS
    return VideoLength(
        seconds=seconds,
        max_spoken=seconds + 5,
        render_min=seconds - 5,
        render_max=seconds + 6,
        check_min=seconds - 7,
        check_max=seconds + 7,
        min_words=max(14, round(seconds * 1.6)),
    )
