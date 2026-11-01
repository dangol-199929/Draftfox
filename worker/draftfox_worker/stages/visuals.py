"""Visuals stage: one portrait image per scene with ComfyUI, in a PS2-era game look.

There's no PS2-style LoRA installed, so the look comes from the prompt words below; the render stage adds the
low-resolution, reduced-colour finish. Which model draws is VIDEO_IMAGE_MODEL: "flux2-klein" (FLUX.2 Klein 4B,
which ComfyUI Desktop's template installs; the default: about 10 s an image here and closest to the look) or
"sdxl" (SDXL base 1.0: about 18 s, and at this tall size it tends to draw comic-style panels)."""

from __future__ import annotations

import time
from typing import Any

from ..comfy import Comfy, load_workflow, new_seed
from ..context import StageContext, StageError
from ..gpu import gpu_lease

WIDTH, HEIGHT = 768, 1344

# No console names or "screenshot": those make the models draw game HUDs and console logos.
STYLE = (
    "early 2000s low-poly 3D render, retro game art style, chunky simple models, low-resolution textures, "
    "simple vertex lighting, soft distance fog, slightly washed-out colours, full-frame scene with no interface, no text"
)
NEGATIVE = (
    "text, letters, words, caption, watermark, logo, signature, user interface, HUD, score, health bar, "
    "comic, panels, collage, multiple views, border, photo, photorealistic, 4k"
)

MODELS = {
    "sdxl": {
        "workflow": "sdxl_portrait",
        "values": lambda c: {"checkpoint": c.get("VIDEO_SDXL_CHECKPOINT", "sd_xl_base_1.0.safetensors"), "steps": 25},
    },
    "flux2-klein": {
        "workflow": "flux2_klein_portrait",
        "values": lambda c: {"unet": c.get("VIDEO_FLUX_UNET", "flux-2-klein-4b-fp8.safetensors"), "steps": 4},
    },
}


def scene_prompt(scene: dict[str, Any], style: str) -> str:
    return f"{scene['image_prompt'].strip().rstrip('.')}. {STYLE}. {style}".strip()


def run(ctx: StageContext) -> dict[str, Any]:
    scenes: list[dict[str, Any]] = [dict(scene) for scene in ctx.job.get("scenes") or []]
    if not scenes:
        raise StageError("The script has no scenes.", retryable=False)
    model = ctx.config.get("VIDEO_IMAGE_MODEL", "flux2-klein")
    if model not in MODELS:
        raise StageError(f"VIDEO_IMAGE_MODEL must be one of {', '.join(MODELS)}.", retryable=False)
    redo = set((ctx.job.get("redo") or {}).get("scenes") or [])
    style = (ctx.job.get("script") or {}).get("style", "")

    # Scenes that already have an image (from an interrupted run, or not picked for a redo) are kept.
    todo = [i for i in range(len(scenes)) if i in redo or not ctx.existing_asset(f"scene-{i + 1}")]
    timings: dict[str, float] = dict((ctx.job.get("assets") or {}).get("image_seconds") or {})
    if todo:
        comfy = Comfy(ctx.config)
        comfy.ensure_running()
        spec = MODELS[model]
        with gpu_lease(ctx, "Video scene images", uses="comfyui"):
            for done, index in enumerate(todo):
                ctx.progress(done / len(todo), f"Drawing scene {index + 1} of {len(scenes)} with {model}")
                values = {
                    "prompt": scene_prompt(scenes[index], style),
                    "negative": NEGATIVE,
                    "width": WIDTH,
                    "height": HEIGHT,
                    "seed": new_seed(),
                    **spec["values"](ctx.config),
                }
                started = time.monotonic()
                path = comfy.run(load_workflow(spec["workflow"], values), ctx.dir / f"scene-{index + 1}.png", ctx.check)
                timings[f"scene-{index + 1}"] = round(time.monotonic() - started, 1)
                ctx.save_asset(f"scene-{index + 1}", path)
    for index, scene in enumerate(scenes):
        scene["image"] = f"scene-{index + 1}.png"
    ctx.progress(1, "Scene images ready")
    return {"scenes": scenes, "assets": {"image_seconds": timings, "image_model": model}}
