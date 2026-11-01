# Draftfox video worker

Makes the Video Studio's short videos. It runs next to Draftfox (on the same PC, or another computer on the
network) and talks to it only over HTTP: it claims a queued video, runs its stages one by one (script, visuals,
audio, render, quality check), reports each one, and moves on. Files go in `data/videos/<job id>/`.

Each finished stage is saved, so if the worker stops or the PC restarts, the video carries on from the last
finished stage. A stage that fails is tried up to 3 times; then the video is marked failed with the reason.

## Set up (Windows)

1. Python 3.12: `winget install Python.Python.3.12`
2. In this folder: `py -3.12 -m venv .venv` (or the full path to Python 3.12's `python.exe`), then
   `.venv\Scripts\pip install -r requirements.txt`
3. Put `WORKER_TOKEN=<a long random string>` in Draftfox's `.env` and restart Draftfox. The worker reads the same
   file. On another computer, put `WORKER_TOKEN` and `DRAFTFOX_URL=http://<draftfox pc>:3000` in `worker/.env`.
4. Run it: `.venv\Scripts\python worker.py` (or `--once` for a single job).

## Settings (in .env or worker/.env)

| Name | Default | What it does |
| --- | --- | --- |
| `WORKER_TOKEN` | (required) | Must match Draftfox's |
| `DRAFTFOX_URL` | `http://127.0.0.1:3000` | Where Draftfox runs |
| `WORKER_ID` | `<computer name>-worker` | Name shown in the Video Studio |
| `WORKER_DUMMY` | | `1` runs placeholder stages only, for testing |

Topics starting with `test:` always use the placeholder stages; `test: fail` fails on purpose.
