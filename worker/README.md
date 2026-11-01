# Draftfox video worker

Makes the Video Studio's short videos. It runs next to Draftfox (on the same PC, or another computer on the
network) and talks to Draftfox only over HTTP: it claims a queued video, runs its stages one by one, reports each
one, and moves on. Files go in `data/videos/<job id>/`.

| Stage | What it does | Uses |
| --- | --- | --- |
| script | Title, ~25-word narration, 2-3 scenes, post caption, hashtags, mood (Draftfox writes it with `VIDEO_SCRIPT_MODEL`) | Ollama, GPU |
| visuals | One 768x1344 image per scene, in an early-2000s low-poly game look, then a 4-5 s LTX-Video clip of it (480x832; the still image is kept for a scene whose clip fails) | ComfyUI, GPU |
| audio | The narration spoken (at most 12 s; sped up a little or rewritten shorter if needed), word timings, captions (ASS, 2-3 words at a time) | Kokoro and faster-whisper, CPU |
| render | 1080x1920, 30 fps, H.264/AAC, ~10 s: each scene's clip (slowed a little or holding its last frame to fit), or a slow zoom/pan of a still image, crossfades, low-res reduced-colour retro finish, burned-in captions, narration and music from `data/videos/music/<mood>/` (optional) | FFmpeg |
| qc | Length, size, codec, sound, captions, black frames, a full decode, and no other video on the same topic | FFmpeg |

Each finished stage is saved, so if the worker stops or the PC restarts, the video carries on from the last
finished stage. A stage that fails is tried up to 3 times; then the video is marked failed with the reason (a
failed quality check stops at once). The GPU is shared through Draftfox's GPU lease: the app's own requests (posts,
images, auto-posting) go first, and the worker gives the card back between stages and between scenes. The worker
takes no GPU work from 20:40 to 21:20 Sydney time (from 20:37, so a scene can't run into it).

## Set up (Windows)

1. Python 3.12 (`winget install Python.Python.3.12`) and FFmpeg (`winget install Gyan.FFmpeg`).
2. In this folder: `py -3.12 -m venv .venv` (or the full path to Python 3.12's `python.exe`), then
   `.venv\Scripts\pip install -r requirements.txt`. The first run downloads Kokoro's voice model and Whisper's
   `base.en` model from Hugging Face.
3. ComfyUI with FLUX.2 Klein 4B (ComfyUI Desktop's "Flux.2 Klein 4B Distilled" template downloads it) and, for
   motion, `ltxv-2b-0.9.8-distilled-fp8.safetensors` (checkpoints) with `t5xxl_fp8_e4m3fn_scaled.safetensors` (text encoders).
4. Put `WORKER_TOKEN=<a long random string>` in Draftfox's `.env` and restart Draftfox. The worker reads the same
   file. On another computer, put `WORKER_TOKEN` and `DRAFTFOX_URL=http://<draftfox pc>:3000` in `worker/.env`.
5. Run it: `.venv\Scripts\python worker.py` (or `--once` for a single job).

## Settings (in .env or worker/.env)

| Name | Default | What it does |
| --- | --- | --- |
| `WORKER_TOKEN` | (required) | Must match Draftfox's |
| `DRAFTFOX_URL` | `http://127.0.0.1:3000` | Where Draftfox runs |
| `WORKER_ID` | `<computer name>-worker` | Name shown in the Video Studio |
| `COMFYUI_URL` | `http://127.0.0.1:8188` | Where ComfyUI runs |
| `COMFYUI_START` | | A command that starts ComfyUI; the worker runs it when nothing answers at `COMFYUI_URL` |
| `VIDEO_IMAGE_MODEL` | `flux2-klein` | `flux2-klein` (about 10 s an image on an RTX 5050) or `sdxl` (SDXL base 1.0, about 20 s) |
| `VIDEO_FLUX_UNET` | `flux-2-klein-4b-fp8.safetensors` | FLUX.2 Klein model file |
| `VIDEO_SDXL_CHECKPOINT` | `sd_xl_base_1.0.safetensors` | SDXL checkpoint file |
| `VIDEO_MOTION` | `ltx` | `ltx` animates each scene; `off` keeps still images. Videos added with Motion unticked in the Video Studio stay still either way |
| `VIDEO_MOTION_TIMEOUT` | `300` | Seconds one clip may take before the scene falls back to its still image |
| `VIDEO_LTX_CHECKPOINT`, `VIDEO_LTX_TEXT_ENCODER` | the files above | LTX model files |
| `VIDEO_VOICE` | `bm_george` | Kokoro voice (British English voices start with `b`, American with `a`); samples in DraftfoxHub/voice-samples |
| `VIDEO_VOICE_SPEED` | `0.9` | Speaking speed; the audio stage speeds up by 0.1 or 0.2 if the narration runs long. If you change it, Draftfox writes the scripts to match (src/lib/video-length.ts) |
| `VIDEO_WHISPER_MODEL` | `base.en` | faster-whisper model for caption timings (`small.en` is slower, a little more exact) |
| `FFMPEG`, `FFPROBE` | on PATH | Full paths if they aren't on PATH |
| `WORKER_DUMMY` | | `1` runs placeholder stages only, for testing |

Topics starting with `test:` always use the placeholder stages; `test: fail` fails on purpose.

Background music: put tracks (mp3, wav, m4a, ogg, flac) in `data/videos/music/<mood>/`, where mood is one of
calm, upbeat, inspiring, dramatic, playful, mysterious. Without any, videos have narration only.
