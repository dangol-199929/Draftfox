"""Stand-in stages for testing the queue: they wait a few seconds and write small placeholder files.
Used for every stage when WORKER_DUMMY=1, and for jobs whose topic starts with "test:".
A topic starting with "test: fail" fails its script stage every time, for testing retries."""

from __future__ import annotations

import json
import time
from typing import Any

from ..context import StageContext, StageError

STEPS = 5
STEP_SECONDS = 1.0


def _wait(ctx: StageContext) -> None:
    for step in range(STEPS):
        time.sleep(STEP_SECONDS)
        ctx.progress((step + 1) / STEPS)


def script(ctx: StageContext) -> dict[str, Any]:
    _wait(ctx)
    topic = ctx.job["topic"]
    if topic.lower().startswith("test: fail"):
        raise StageError("Dummy failure, for testing retries")
    scenes = [{"image_prompt": f"Placeholder scene {i + 1} for {topic}", "on_screen_text": f"Scene {i + 1}"} for i in range(3)]
    return {
        "script": {
            "title": f"Test: {topic}"[:80],
            "topic": topic,
            "narration": "This is a placeholder narration written by the dummy stage to test the video queue end to end.",
            "scenes": scenes,
            "post_caption": "A test video.",
            "hashtags": ["#test"],
            "mood": "calm",
            "style": "test",
        },
        "scenes": scenes,
    }


def _placeholder(ctx: StageContext, name: str, content: dict[str, Any]) -> None:
    path = ctx.dir / f"{name}.json"
    path.write_text(json.dumps(content, indent=2), encoding="utf-8")
    ctx.save_asset(name, path)


def visuals(ctx: StageContext) -> dict[str, Any]:
    for index, _scene in enumerate(ctx.job.get("scenes") or []):
        if not ctx.existing_asset(f"scene-{index + 1}"):
            time.sleep(STEP_SECONDS)
            _placeholder(ctx, f"scene-{index + 1}", {"scene": index + 1})
        ctx.progress((index + 1) / max(1, len(ctx.job.get("scenes") or [])))
    return {}


def audio(ctx: StageContext) -> dict[str, Any]:
    _wait(ctx)
    _placeholder(ctx, "narration", {"seconds": 10})
    return {}


def render(ctx: StageContext) -> dict[str, Any]:
    _wait(ctx)
    path = ctx.dir / "video.txt"
    path.write_text("placeholder video", encoding="utf-8")
    ctx.save_asset("video", path)
    return {"outputPath": str(path)}


def qc(ctx: StageContext) -> dict[str, Any]:
    _wait(ctx)
    return {"qc": {"passed": True, "checks": {"dummy": True}}}


STAGES = {"script": script, "visuals": visuals, "audio": audio, "render": render, "qc": qc}
