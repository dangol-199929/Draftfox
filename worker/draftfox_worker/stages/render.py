"""Render stage: the scene images, narration, captions and (optional) music become a 1080x1920, 30 fps H.264/AAC MP4
of about 10 seconds. Each scene slowly zooms or pans, scenes crossfade, and the picture gets a PS2-era finish:
rendered at low resolution, colours reduced a little, then scaled back up with hard pixel edges."""

from __future__ import annotations

import random
from pathlib import Path
from typing import Any

from ..context import StageContext, StageError
from ..ffmpeg import duration, run_ffmpeg
from .audio import write_ass

WIDTH, HEIGHT, FPS = 1080, 1920, 30
TARGET_SECONDS = 10.0
MAX_SECONDS = 12.5
FADE = 0.5
NARRATION_DELAY = 0.3
# The retro look: the low resolution it's drawn at, and how many levels each colour channel keeps.
RETRO_WIDTH, RETRO_HEIGHT = 360, 640
COLOUR_STEP = 8  # 256 / 8 = 32 levels per channel
MUSIC_TYPES = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}


def pick_music(ctx: StageContext, mood: str) -> Path | None:
    folder = ctx.dir.parent / "music" / (mood or "calm")
    tracks = sorted(p for p in folder.glob("*") if p.suffix.lower() in MUSIC_TYPES) if folder.is_dir() else []
    return random.choice(tracks) if tracks else None


def motion(index: int, frames: int) -> str:
    """Zoom in, pan across, or zoom out, so consecutive scenes move differently."""
    step = 0.15 / frames
    if index % 3 == 0:
        return f"zoompan=z='min(1+{step}*on,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
    if index % 3 == 1:
        return f"zoompan=z=1.12:x='(iw-iw/zoom)*on/{frames}':y='ih/2-(ih/zoom/2)'"
    return f"zoompan=z='max(1.15-{step}*on,1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"


def run(ctx: StageContext) -> dict[str, Any]:
    files = (ctx.job.get("assets") or {}).get("files") or {}
    scenes = ctx.job.get("scenes") or []
    images = [ctx.dir / files[f"scene-{i + 1}"] for i in range(len(scenes)) if f"scene-{i + 1}" in files]
    if len(images) < 2 or not all(p.is_file() for p in images):
        raise StageError("Some scene images are missing; make the visuals again.", retryable=False)
    narration = ctx.dir / files.get("narration", "narration.wav")
    captions = ctx.dir / files.get("captions", "captions.ass")
    groups = (ctx.job.get("assets") or {}).get("caption_groups")
    if groups:
        # Rewritten each render, so captions edited in the Video Studio are used.
        write_ass(groups, captions)
    if not narration.is_file() or not captions.is_file():
        raise StageError("The narration or captions are missing; make the audio again.", retryable=False)

    speech = duration(ctx.config, narration)
    total = min(max(TARGET_SECONDS, speech + NARRATION_DELAY + 0.6), MAX_SECONDS)
    count = len(images)
    clip = (total + (count - 1) * FADE) / count
    frames = int(round(clip * FPS))
    mood = (ctx.job.get("script") or {}).get("mood", "calm")
    music = pick_music(ctx, mood)

    inputs: list[str] = []
    for image in images:
        # One frame per image: zoompan turns it into `frames` frames.
        inputs += ["-i", image.name]
    inputs += ["-i", narration.name]
    if music:
        inputs += ["-stream_loop", "-1", "-i", str(music)]

    parts = []
    for i in range(count):
        # Upscale first so the slow zoom moves smoothly instead of in whole-pixel jumps.
        parts.append(
            f"[{i}:v]scale={WIDTH * 2}:{HEIGHT * 2}:force_original_aspect_ratio=increase,crop={WIDTH * 2}:{HEIGHT * 2},"
            f"{motion(i, frames)}:d={frames}:s={WIDTH}x{HEIGHT}:fps={FPS},setsar=1,format=yuv420p[v{i}]"
        )
    last = "v0"
    for i in range(1, count):
        offset = i * (clip - FADE)
        parts.append(f"[{last}][v{i}]xfade=transition=fade:duration={FADE}:offset={offset:.3f}[x{i}]")
        last = f"x{i}"
    levels = f"floor(val/{COLOUR_STEP})*{COLOUR_STEP}"
    parts.append(
        f"[{last}]scale={RETRO_WIDTH}:{RETRO_HEIGHT}:flags=area,lutrgb=r='{levels}':g='{levels}':b='{levels}',"
        f"scale={WIDTH}:{HEIGHT}:flags=neighbor,subtitles={captions.name},format=yuv420p[video]"
    )
    delay = int(NARRATION_DELAY * 1000)
    voice = f"[{count}:a]aresample=48000,adelay={delay}|{delay},apad"
    if music:
        parts.append(f"{voice}[voice]")
        parts.append(
            f"[{count + 1}:a]aresample=48000,volume=0.12,afade=t=out:st={total - 1:.3f}:d=1[music]"
        )
        parts.append("[voice][music]amix=inputs=2:duration=first:normalize=0[audio]")
    else:
        parts.append(f"{voice}[audio]")

    out = ctx.dir / "video.mp4"
    ctx.progress(0.1, f"Rendering {total:.1f} s from {count} scenes{' with music' if music else ''}")
    run_ffmpeg(
        ctx.config,
        [
            "-y",
            *inputs,
            "-filter_complex",
            ";".join(parts),
            "-map",
            "[video]",
            "-map",
            "[audio]",
            "-t",
            f"{total:.3f}",
            "-r",
            str(FPS),
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-ar",
            "48000",
            "-movflags",
            "+faststart",
            out.name,
        ],
        cwd=ctx.dir,
    )
    ctx.save_asset("video", out)
    ctx.progress(1, "Rendered")
    return {
        "outputPath": str(out),
        "assets": {"video_seconds": round(total, 2), "music": music.name if music else None},
    }
