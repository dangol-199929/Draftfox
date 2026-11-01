"""Script stage: Draftfox writes the title, narration, scenes and caption with the local model (see
src/lib/video-script.ts). The worker holds the graphics card meanwhile."""

from __future__ import annotations

from typing import Any

from ..client import ApiError
from ..context import StageContext, StageError
from ..gpu import gpu_lease


def write_script(ctx: StageContext, max_words: int | None = None) -> dict[str, Any]:
    ctx.progress(0.1, "Writing the script" if max_words is None else f"Rewriting the narration in at most {max_words} words")
    with gpu_lease(ctx, "Video script"):
        try:
            answer = ctx.client.post(
                f"/api/worker/jobs/{ctx.job_id}/script",
                {} if max_words is None else {"maxWords": max_words},
                timeout=16 * 60,
            )
        except ApiError as error:
            if error.status == 502:
                raise StageError(error.message) from None
            raise
    script = answer["script"]
    ctx.progress(1, f"Script written with {answer['model']} in {answer['seconds']:.1f} s ({answer['attempts']} tries)")
    return script


def run(ctx: StageContext) -> dict[str, Any]:
    script = write_script(ctx)
    return {"script": script, "scenes": script["scenes"]}
