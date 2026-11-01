"""Visuals stage: one portrait image per scene with ComfyUI, in a PS2-era game look, then (unless motion is off) a
short LTX-Video clip made from that image.

There's no PS2-style LoRA installed, so the look comes from the prompt words below; the render stage adds the
low-resolution, reduced-colour finish. Which model draws is VIDEO_IMAGE_MODEL: "flux2-klein" (FLUX.2 Klein 4B,
which ComfyUI Desktop's template installs; the default: about 10 s an image here and closest to the look) or
"sdxl" (SDXL base 1.0: about 18 s, and at this tall size it tends to draw comic-style panels).

Motion is VIDEO_MOTION: "ltx" (the default) animates each image with LTX-Video 2B distilled, 480x832 at 24 fps, about
30 s a clip here; "off" keeps the still images, which the render stage slowly zooms. A video added with Motion
unticked in the Video Studio stays still too. A scene whose clip fails or times out keeps its still image.

The GPU lease is taken one scene at a time (image and clip together), so the app's own requests can go between scenes."""

from __future__ import annotations

import time
from typing import Any

from ..comfy import Comfy, load_workflow, new_seed
from ..context import StageContext, StageError
from ..gpu import gpu_lease

WIDTH, HEIGHT = 768, 1344
CLIP_WIDTH, CLIP_HEIGHT, CLIP_FPS = 480, 832, 24
# LTX clip lengths must be 8n+1 frames: 97 is 4.0 s, 121 is 5.0 s (the longest tried on this card's 8 GB).
CLIP_FRAMES = (97, 121)

# No console names or "screenshot": those make the models draw game HUDs and console logos.
STYLE = (
    "early 2000s low-poly 3D render, retro game art style, chunky simple models, low-resolution textures, "
    "simple vertex lighting, soft distance fog, slightly washed-out colours, full-frame scene with no interface, no text"
)
# Screens, signs and books are left out too: they'd have writing on them, which the motion model garbles.
NEGATIVE = (
    "text, letters, words, caption, watermark, logo, signature, user interface, HUD, score, health bar, "
    "screen, phone screen, monitor, sign, signboard, book pages, newspaper, "
    "comic, panels, collage, multiple views, border, photo, photorealistic, 4k"
)
MOTION_NEGATIVE = "static, frozen, blurry, distorted face, extra limbs, flicker, morphing, text, watermark, low quality"
DEFAULT_MOTION = "Slow cinematic camera push-in, gentle natural motion, soft light shifting, subtle movement of hair and cloth."

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


def motion_prompt(scene: dict[str, Any]) -> str:
    """What's in the picture, then how it moves (older scripts have no motion_prompt)."""
    move = (scene.get("motion_prompt") or "").strip() or DEFAULT_MOTION
    return f"{scene['image_prompt'].strip().rstrip('.')}. {move}"


def motion_enabled(ctx: StageContext) -> bool:
    if (ctx.job.get("assets") or {}).get("motion") is False:
        return False
    return ctx.config.get("VIDEO_MOTION", "ltx").lower() != "off"


def clip_frames(ctx: StageContext, scene: dict[str, Any]) -> int:
    """About as long as the scene's narration, within what LTX makes well; the render stage stretches or holds the rest."""
    try:
        speed = float(ctx.config.get("VIDEO_VOICE_SPEED", "0.9"))
    except ValueError:
        speed = 0.9
    words = len((scene.get("narration") or "").split())
    seconds = words / (3.0 * speed) if words else CLIP_FRAMES[1] / CLIP_FPS
    frames = round(seconds * CLIP_FPS / 8) * 8 + 1
    return min(max(frames, CLIP_FRAMES[0]), CLIP_FRAMES[1])


def make_clip(ctx: StageContext, comfy: Comfy, scene: dict[str, Any], index: int) -> float:
    """Animates scene-<n>.png into clip-<n>.webm; returns how long it took."""
    started = time.monotonic()
    image = comfy.upload_image(ctx.dir / f"scene-{index + 1}.png", f"draftfox-{ctx.job_id}-scene-{index + 1}.png")
    values = {
        "checkpoint": ctx.config.get("VIDEO_LTX_CHECKPOINT", "ltxv-2b-0.9.8-distilled-fp8.safetensors"),
        "text_encoder": ctx.config.get("VIDEO_LTX_TEXT_ENCODER", "t5xxl_fp8_e4m3fn_scaled.safetensors"),
        "prompt": motion_prompt(scene),
        "negative": MOTION_NEGATIVE,
        "image": image,
        "width": CLIP_WIDTH,
        "height": CLIP_HEIGHT,
        "frames": clip_frames(ctx, scene),
        "fps": CLIP_FPS,
        "seed": new_seed(),
    }
    try:
        timeout = float(ctx.config.get("VIDEO_MOTION_TIMEOUT", "300"))
    except ValueError:
        timeout = 300
    path = comfy.run(load_workflow("ltx_i2v", values), ctx.dir / f"clip-{index + 1}.webm", ctx.check, timeout=timeout)
    ctx.save_asset(f"clip-{index + 1}", path)
    return round(time.monotonic() - started, 1)


def run(ctx: StageContext) -> dict[str, Any]:
    scenes: list[dict[str, Any]] = [dict(scene) for scene in ctx.job.get("scenes") or []]
    if not scenes:
        raise StageError("The script has no scenes.", retryable=False)
    model = ctx.config.get("VIDEO_IMAGE_MODEL", "flux2-klein")
    if model not in MODELS:
        raise StageError(f"VIDEO_IMAGE_MODEL must be one of {', '.join(MODELS)}.", retryable=False)
    redo = set((ctx.job.get("redo") or {}).get("scenes") or [])
    style = (ctx.job.get("script") or {}).get("style", "")
    motion = motion_enabled(ctx)
    assets = ctx.job.get("assets") or {}

    # Images and clips that already exist (from an interrupted run, or not picked for a redo) are kept; a new image
    # always gets a new clip.
    images = [i for i in range(len(scenes)) if i in redo or not ctx.existing_asset(f"scene-{i + 1}")]
    clips = [i for i in range(len(scenes)) if motion and (i in images or not ctx.existing_asset(f"clip-{i + 1}"))]
    timings: dict[str, float] = dict(assets.get("image_seconds") or {})
    clip_timings: dict[str, float] = dict(assets.get("clip_seconds") or {})
    stills: list[int] = [n for n in assets.get("motion_stills") or [] if n - 1 not in clips]
    todo = sorted(set(images) | set(clips))
    if todo:
        comfy = Comfy(ctx.config)
        comfy.ensure_running()
        spec = MODELS[model]
        for done, index in enumerate(todo):
            label = f"scene {index + 1} of {len(scenes)}"
            # One lease per scene: released (and ComfyUI's memory freed) in between, so the app can jump in.
            with gpu_lease(ctx, f"Video {label}", uses="comfyui"):
                if index in images:
                    ctx.progress(done / len(todo), f"Drawing {label} with {model}")
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
                if index in clips:
                    ctx.progress((done + 0.5) / len(todo), f"Animating {label} with LTX")
                    try:
                        clip_timings[f"clip-{index + 1}"] = make_clip(ctx, comfy, scenes[index], index)
                    except (StageError, OSError) as error:
                        # The render stage zooms the still image for this scene instead.
                        stills.append(index + 1)
                        ctx.warn((done + 1) / len(todo), f"Scene {index + 1}: LTX failed, using the still image ({error})")
    for index, scene in enumerate(scenes):
        scene["image"] = f"scene-{index + 1}.png"
    ctx.progress(1, "Scene images and clips ready" if motion else "Scene images ready")
    return {
        "scenes": scenes,
        "assets": {
            "image_seconds": timings,
            "image_model": model,
            "clip_seconds": clip_timings,
            "motion_model": "ltx" if motion else None,
            "motion_stills": sorted(set(stills)) if motion else [],
        },
    }
