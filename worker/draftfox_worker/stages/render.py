"""Render stage: the scene clips (or images), narration, captions and (optional) music become a 1080x1920, 30 fps
H.264/AAC MP4 of about VIDEO_TARGET_SECONDS (see length.py). A scene with an LTX clip plays it, slowed a little or
holding its last frame when the scene runs longer; a scene without one slowly zooms or pans its image. Scenes
crossfade, and the picture gets a PS2-era finish: rendered at low resolution, colours reduced a little, then scaled
back up with hard pixel edges."""

from __future__ import annotations

import random
from pathlib import Path
from typing import Any

from ..context import StageContext, StageError
from ..ffmpeg import duration, run_ffmpeg
from ..length import video_length
from ..settings import caption_style, job_settings
from .audio import write_ass

WIDTH, HEIGHT, FPS = 1080, 1920, 30
FADE = 0.5
NARRATION_DELAY = 0.3
# The retro look per strength (the video's "retro" setting): the low resolution it's drawn at, and the step between
# the levels each colour channel keeps (8: 256 / 8 = 32 levels). "off" leaves the picture as it is.
RETRO = {"light": (540, 960, 4), "normal": (360, 640, 8), "strong": (270, 480, 16)}
MUSIC_VOLUME = 12  # percent
# A clip shorter than its scene plays at most this much slower; after that its last frame is held.
MAX_STRETCH = 1.3
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
        write_ass(groups, captions, caption_style(ctx))
    if not narration.is_file() or not captions.is_file():
        raise StageError("The narration or captions are missing; make the audio again.", retryable=False)

    speech = duration(ctx.config, narration)
    length = video_length(ctx.config, ctx.job)
    total = min(max(length.render_min, speech + NARRATION_DELAY + 0.6), length.render_max)
    count = len(images)
    clip = (total + (count - 1) * FADE) / count
    frames = int(round(clip * FPS))
    settings = job_settings(ctx)
    # "auto" (or no setting) is the mood the script picked; "none" leaves the music out.
    choice = settings.get("music") or "auto"
    mood = (ctx.job.get("script") or {}).get("mood", "calm") if choice == "auto" else choice
    music = None if choice == "none" else pick_music(ctx, mood)
    try:
        volume = float(settings.get("musicVolume", MUSIC_VOLUME)) / 100
    except (TypeError, ValueError):
        volume = MUSIC_VOLUME / 100

    # The visuals stage's LTX clips, where it made them (none when motion was off for this video), and clips you
    # uploaded for a scene (always used).
    assets = ctx.job.get("assets") or {}
    stills = set(assets.get("motion_stills") or [])
    clips: list[Path | None] = [None] * count
    for i in range(count):
        name = files.get(f"clip-{i + 1}")
        own = i < len(scenes) and scenes[i].get("clip_source") == "upload"
        made = assets.get("motion_model") == "ltx" and i + 1 not in stills
        if name and (own or made) and (ctx.dir / name).is_file():
            clips[i] = ctx.dir / name

    inputs: list[str] = []
    for i, image in enumerate(images):
        # One frame per image: zoompan turns it into `frames` frames.
        inputs += ["-i", clips[i].name if clips[i] else image.name]
    inputs += ["-i", narration.name]
    if music:
        inputs += ["-stream_loop", "-1", "-i", str(music)]

    parts = []
    for i in range(count):
        if clips[i]:
            stretch = min(max(clip / duration(ctx.config, clips[i]), 1), MAX_STRETCH)
            parts.append(
                f"[{i}:v]setpts={stretch:.4f}*(PTS-STARTPTS),fps={FPS},"
                f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos,crop={WIDTH}:{HEIGHT},"
                f"tpad=stop_mode=clone:stop_duration={clip:.3f},trim=duration={clip:.3f},setpts=PTS-STARTPTS,"
                f"setsar=1,format=yuv420p[v{i}]"
            )
            continue
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
    finish = []
    retro = RETRO.get(str(settings.get("retro") or "normal"))
    if retro:
        retro_width, retro_height, step = retro
        levels = f"floor(val/{step})*{step}"
        finish.append(
            f"scale={retro_width}:{retro_height}:flags=area,lutrgb=r='{levels}':g='{levels}':b='{levels}',"
            f"scale={WIDTH}:{HEIGHT}:flags=neighbor"
        )
    if settings.get("captions", True) is not False:
        finish.append(f"subtitles={captions.name}")
    finish.append("format=yuv420p")
    parts.append(f"[{last}]{','.join(finish)}[video]")
    delay = int(NARRATION_DELAY * 1000)
    voice = f"[{count}:a]aresample=48000,adelay={delay}|{delay},apad"
    if music:
        parts.append(f"{voice}[voice]")
        parts.append(
            f"[{count + 1}:a]aresample=48000,volume={volume:.3f},afade=t=out:st={total - 1:.3f}:d=1[music]"
        )
        parts.append("[voice][music]amix=inputs=2:duration=first:normalize=0[audio]")
    else:
        parts.append(f"{voice}[audio]")

    out = ctx.dir / "video.mp4"
    moving = sum(1 for c in clips if c)
    ctx.progress(
        0.1,
        f"Rendering {total:.1f} s from {count} scenes ({moving} animated){' with music' if music else ''}",
    )
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
        "assets": {"video_seconds": round(total, 2), "music": music.name if music else None, "animated_scenes": moving},
    }
