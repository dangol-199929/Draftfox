"""A small ComfyUI client: start it if needed, queue an API-format workflow, wait, download the image."""

from __future__ import annotations

import json
import logging
import random
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Callable

from .config import WORKER_DIR, Config
from .context import StageError

log = logging.getLogger("worker.comfy")

WORKFLOW_DIR = WORKER_DIR / "workflows"


class Comfy:
    def __init__(self, config: Config):
        self.url = config.get("COMFYUI_URL", "http://127.0.0.1:8188").rstrip("/")
        self.start_command = config.get("COMFYUI_START", "")

    def _get(self, path: str, timeout: float = 10) -> bytes:
        with urllib.request.urlopen(f"{self.url}{path}", timeout=timeout) as response:
            return response.read()

    def _post(self, path: str, body: dict[str, Any], timeout: float = 30) -> dict[str, Any]:
        request = urllib.request.Request(
            f"{self.url}{path}", data=json.dumps(body).encode(), method="POST", headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                text = response.read().decode() or "{}"
                return json.loads(text)
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:800]
            raise StageError(f"ComfyUI refused the workflow ({error.code}): {detail}") from None

    def is_up(self) -> bool:
        try:
            self._get("/system_stats", timeout=3)
            return True
        except Exception:  # noqa: BLE001
            return False

    def ensure_running(self, wait_seconds: float = 180) -> None:
        if self.is_up():
            return
        if not self.start_command:
            raise StageError(f"ComfyUI isn't running at {self.url}. Start it (or set COMFYUI_START to its start script).")
        log.info("Starting ComfyUI: %s", self.start_command)
        # Detached, so ComfyUI keeps running for later jobs and isn't tied to this stage.
        subprocess.Popen(
            ["cmd.exe", "/c", self.start_command],
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW,
            close_fds=True,
        )
        deadline = time.monotonic() + wait_seconds
        while time.monotonic() < deadline:
            time.sleep(3)
            if self.is_up():
                return
        raise StageError(f"ComfyUI didn't start within {int(wait_seconds)} seconds.")

    def run(self, workflow: dict[str, Any], out_path: Path, check: Callable[[], None], timeout: float = 600) -> Path:
        """Queues the workflow, waits for its first image and saves it to out_path."""
        queued = self._post("/prompt", {"prompt": workflow, "client_id": str(uuid.uuid4())})
        prompt_id = queued.get("prompt_id")
        if not prompt_id:
            raise StageError(f"ComfyUI didn't queue the workflow: {json.dumps(queued)[:500]}")
        deadline = time.monotonic() + timeout
        while True:
            check()
            if time.monotonic() > deadline:
                self._post("/interrupt", {})
                raise StageError(f"ComfyUI took longer than {int(timeout)} s for one image.")
            history = json.loads(self._get(f"/history/{prompt_id}"))
            entry = history.get(prompt_id) or {}
            status = entry.get("status") or {}
            if status.get("status_str") == "error":
                messages = [m[1].get("exception_message", "") for m in status.get("messages", []) if m[0] == "execution_error"]
                raise StageError(f"ComfyUI failed: {' '.join(messages)[:500] or 'unknown error'}")
            images = [image for output in (entry.get("outputs") or {}).values() for image in output.get("images", [])]
            if images:
                image = images[0]
                query = urllib.parse.urlencode(
                    {"filename": image["filename"], "subfolder": image.get("subfolder", ""), "type": image.get("type", "output")}
                )
                out_path.write_bytes(self._get(f"/view?{query}", timeout=60))
                return out_path
            time.sleep(1)


def load_workflow(name: str, values: dict[str, Any]) -> dict[str, Any]:
    """Reads worker/workflows/<name>.json and fills its "{{placeholders}}" (numbers stay numbers)."""
    text = (WORKFLOW_DIR / f"{name}.json").read_text(encoding="utf-8")
    for key, value in values.items():
        if isinstance(value, (int, float)):
            text = text.replace(f'"{{{{{key}}}}}"', json.dumps(value))
        else:
            text = text.replace(f"{{{{{key}}}}}", json.dumps(str(value))[1:-1])
    return json.loads(text)


def new_seed() -> int:
    return random.randint(0, 2**31 - 1)
