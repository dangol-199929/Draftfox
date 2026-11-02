"""A video's own settings (assets.settings, chosen in the Video Studio; see src/lib/video-settings.ts). Anything a
video doesn't set falls back to .env, then to the defaults here."""

from __future__ import annotations

from typing import Any

from .context import StageContext


def job_settings(ctx: StageContext) -> dict[str, Any]:
    return dict(((ctx.job.get("assets") or {}).get("settings")) or {})


def voice(ctx: StageContext) -> str:
    return str(job_settings(ctx).get("voice") or ctx.config.get("VIDEO_VOICE", "bm_george"))


def voice_speed(ctx: StageContext) -> float:
    try:
        return float(job_settings(ctx).get("voiceSpeed") or ctx.config.get("VIDEO_VOICE_SPEED", "0.9"))
    except (TypeError, ValueError):
        return 0.9


# Caption looks: font size, and ASS alignment (numpad positions: 2 bottom, 5 middle, 8 top) with its vertical margin.
CAPTION_SIZES = {"small": 72, "medium": 92, "large": 116}
CAPTION_PLACES = {"bottom": (2, 520), "middle": (5, 0), "top": (8, 260)}


def caption_style(ctx: StageContext) -> dict[str, Any]:
    s = job_settings(ctx)
    colour = str(s.get("captionColor") or "#FFFFFF").lstrip("#")
    if len(colour) != 6:
        colour = "FFFFFF"
    alignment, margin = CAPTION_PLACES.get(str(s.get("captionPosition")), CAPTION_PLACES["bottom"])
    return {
        "size": CAPTION_SIZES.get(str(s.get("captionSize")), CAPTION_SIZES["medium"]),
        # ASS colours are &HAABBGGRR.
        "colour": f"&H00{colour[4:6]}{colour[2:4]}{colour[0:2]}".upper(),
        "alignment": alignment,
        "margin": margin,
    }
