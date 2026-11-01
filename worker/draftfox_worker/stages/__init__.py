"""The pipeline's stages. Each takes a StageContext and returns what it made, as the stage API's `result`."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from ..context import StageContext
from . import dummy

Stage = Callable[[StageContext], dict[str, Any]]

# Real stages are added here as they're built; any stage missing falls back to the dummy one.
REAL_STAGES: dict[str, Stage] = {}


def stage_for(name: str, use_dummy: bool) -> Stage:
    if use_dummy or name not in REAL_STAGES:
        return dummy.STAGES[name]
    return REAL_STAGES[name]
