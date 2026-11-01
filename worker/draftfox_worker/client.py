"""The worker's only way to talk to Draftfox: JSON over HTTP with the bearer token."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from .config import Config


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(f"{status}: {message}")
        self.status = status
        self.message = message


class DraftfoxClient:
    def __init__(self, config: Config):
        self.config = config

    def request(self, method: str, path: str, body: dict[str, Any] | None = None, timeout: float = 30) -> dict[str, Any]:
        data = None
        if body is not None:
            data = json.dumps({"workerId": self.config.worker_id, **body}).encode("utf-8")
        request = urllib.request.Request(
            f"{self.config.draftfox_url}{path}",
            data=data,
            method=method,
            headers={"Authorization": f"Bearer {self.config.token}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as error:
            try:
                message = json.loads(error.read().decode("utf-8")).get("error", error.reason)
            except Exception:  # noqa: BLE001 - any unreadable error body
                message = str(error.reason)
            raise ApiError(error.code, message) from None

    def post(self, path: str, body: dict[str, Any] | None = None, timeout: float = 30) -> dict[str, Any]:
        return self.request("POST", path, body or {}, timeout)

    def get(self, path: str, timeout: float = 30) -> dict[str, Any]:
        return self.request("GET", path, None, timeout)

    # --- Worker API ---

    def claim(self) -> dict[str, Any]:
        return self.post("/api/worker/claim")

    def heartbeat(self, **status: Any) -> dict[str, Any]:
        return self.post("/api/worker/heartbeat", status, timeout=10)

    def progress(self, job_id: str, progress: float, message: str | None = None) -> None:
        self.post(f"/api/worker/jobs/{job_id}/progress", {"progress": progress, "message": message})

    def register_asset(self, job_id: str, name: str, path: str) -> None:
        self.post(f"/api/worker/jobs/{job_id}/assets", {"name": name, "path": path})

    def complete_stage(self, job_id: str, stage: str, result: dict[str, Any], seconds: float) -> dict[str, Any]:
        return self.post(f"/api/worker/jobs/{job_id}/stage", {"stage": stage, "result": result, "seconds": seconds})

    def gpu(self, action: str, purpose: str = "", uses: str = "", wait_seconds: float = 0, ttl_seconds: float = 300) -> dict[str, Any]:
        body = {"action": action, "purpose": purpose, "uses": uses, "waitSeconds": wait_seconds, "ttlSeconds": ttl_seconds}
        return self.post("/api/worker/gpu", body, timeout=wait_seconds + 30)

    def fail_stage(self, job_id: str, stage: str, error: str, retryable: bool = True) -> dict[str, Any]:
        return self.post(f"/api/worker/jobs/{job_id}/fail", {"stage": stage, "error": error, "retryable": retryable})
