"""Running FFmpeg and FFprobe (paths from FFMPEG / FFPROBE, else whatever is on PATH)."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from .config import Config
from .context import StageError


def _tool(config: Config, name: str) -> str:
    return config.get(name.upper(), name)


def run_ffmpeg(config: Config, args: list[str], cwd: Path, timeout: float = 600) -> str:
    """Runs ffmpeg and returns its log (stderr). Raises StageError with the end of the log on failure."""
    try:
        result = subprocess.run(
            [_tool(config, "ffmpeg"), "-hide_banner", "-nostdin", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except FileNotFoundError:
        raise StageError("FFmpeg isn't installed (or FFMPEG doesn't point to it).", retryable=False) from None
    except subprocess.TimeoutExpired:
        raise StageError(f"FFmpeg took longer than {int(timeout)} s.") from None
    if result.returncode != 0:
        raise StageError(f"FFmpeg failed: {result.stderr.strip()[-800:]}")
    return result.stderr


def probe(config: Config, path: Path) -> dict[str, Any]:
    try:
        result = subprocess.run(
            [_tool(config, "ffprobe"), "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)],
            capture_output=True,
            text=True,
            timeout=60,
        )
    except FileNotFoundError:
        raise StageError("FFprobe isn't installed (or FFPROBE doesn't point to it).", retryable=False) from None
    if result.returncode != 0:
        raise StageError(f"FFprobe couldn't read {path.name}: {result.stderr.strip()[-400:]}")
    return json.loads(result.stdout)


def duration(config: Config, path: Path) -> float:
    return float(probe(config, path)["format"]["duration"])
