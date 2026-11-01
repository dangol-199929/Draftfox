"""Quality check: the rendered MP4 is the right length and size, has sound and captions, isn't black anywhere,
decodes from start to end, and isn't a second video on a topic already made. A failure stops the job (rendering
the same inputs again wouldn't fix it) with the reasons."""

from __future__ import annotations

import re
from typing import Any

from ..context import StageContext, StageError
from ..ffmpeg import probe, run_ffmpeg

MIN_SECONDS, MAX_SECONDS = 8.0, 13.0
MIN_BLACK_SECONDS = 0.5


def run(ctx: StageContext) -> dict[str, Any]:
    files = (ctx.job.get("assets") or {}).get("files") or {}
    video = ctx.dir / files.get("video", "video.mp4")
    if not video.is_file():
        raise StageError("There's no rendered video to check.", retryable=False)
    checks: dict[str, Any] = {}
    problems: list[str] = []

    info = probe(ctx.config, video)
    streams = info.get("streams", [])
    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)
    seconds = float(info["format"].get("duration", 0))
    checks["duration"] = round(seconds, 2)
    if not MIN_SECONDS <= seconds <= MAX_SECONDS:
        problems.append(f"it's {seconds:.1f} s long (expected {MIN_SECONDS:.0f}-{MAX_SECONDS:.0f} s)")
    if not video_stream:
        problems.append("it has no video stream")
    else:
        size = f"{video_stream.get('width')}x{video_stream.get('height')}"
        checks["resolution"] = size
        checks["codec"] = video_stream.get("codec_name")
        if size != "1080x1920":
            problems.append(f"it's {size}, not 1080x1920")
        if video_stream.get("codec_name") != "h264":
            problems.append(f"the video is {video_stream.get('codec_name')}, not H.264")
    checks["audio"] = audio_stream.get("codec_name") if audio_stream else None
    if not audio_stream:
        problems.append("it has no sound")

    captions = ctx.dir / files.get("captions", "captions.ass")
    checks["captions"] = captions.is_file() and "Dialogue:" in captions.read_text(encoding="utf-8", errors="replace")
    if not checks["captions"]:
        problems.append("the captions file is missing or empty")

    ctx.progress(0.4, "Looking for black frames")
    log = run_ffmpeg(ctx.config, ["-i", video.name, "-vf", f"blackdetect=d={MIN_BLACK_SECONDS}:pix_th=0.10", "-an", "-f", "null", "-"], cwd=ctx.dir)
    black = [(float(a), float(b)) for a, b in re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", log)]
    checks["black_segments"] = black
    if black:
        problems.append(f"it's black for {sum(b - a for a, b in black):.1f} s")

    ctx.progress(0.7, "Decoding the whole video")
    decode = run_ffmpeg(ctx.config, ["-v", "error", "-i", video.name, "-f", "null", "-"], cwd=ctx.dir)
    checks["decode_errors"] = decode.strip()[:500]
    if decode.strip():
        problems.append("it has decoding errors")

    duplicates = ctx.client.get(f"/api/worker/jobs/{ctx.job_id}").get("duplicates", [])
    checks["duplicates"] = duplicates
    if duplicates:
        problems.append(f"there's already a video on this topic ({len(duplicates)})")

    checks["passed"] = not problems
    if problems:
        # The checks are saved with the failure message; the video file stays for a look.
        raise StageError("Quality check failed: " + "; ".join(problems) + ".", retryable=False)
    ctx.progress(1, "Quality check passed")
    return {"qc": checks}
