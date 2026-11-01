"""The pipeline's stages. Each takes a StageContext and returns what it made, as the stage API's `result`."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from ..context import StageContext
from . import audio, dummy, qc, render, script, visuals

Stage = Callable[[StageContext], dict[str, Any]]

REAL_STAGES: dict[str, Stage] = {
    "script": script.run,
    "visuals": visuals.run,
    "audio": audio.run,
    "render": render.run,
    "qc": qc.run,
}


def stage_for(name: str, use_dummy: bool) -> Stage:
    return dummy.STAGES[name] if use_dummy else REAL_STAGES[name]
