"""Settings, read from the environment, then worker/.env, then the app's own .env (for WORKER_TOKEN and friends)."""

from __future__ import annotations

import os
import socket
from dataclasses import dataclass
from pathlib import Path

WORKER_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = WORKER_DIR.parent


def _read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        values[name.strip()] = value.strip().strip('"').strip("'")
    return values


def _settings() -> dict[str, str]:
    merged = _read_env_file(REPO_DIR / ".env")
    merged.update(_read_env_file(WORKER_DIR / ".env"))
    merged.update({key: value for key, value in os.environ.items() if value})
    return merged


@dataclass(frozen=True)
class Config:
    draftfox_url: str
    token: str
    worker_id: str
    poll_seconds: float
    heartbeat_seconds: float
    dummy: bool
    values: dict[str, str]

    def get(self, name: str, default: str = "") -> str:
        return self.values.get(name, default) or default


def load_config() -> Config:
    values = _settings()
    token = values.get("WORKER_TOKEN", "")
    if len(token) < 32:
        raise SystemExit("WORKER_TOKEN is missing from .env (it must match the one Draftfox uses).")
    return Config(
        draftfox_url=values.get("DRAFTFOX_URL", "http://127.0.0.1:3000").rstrip("/"),
        token=token,
        worker_id=values.get("WORKER_ID", f"{socket.gethostname()}-worker"),
        poll_seconds=float(values.get("WORKER_POLL_SECONDS", "5")),
        heartbeat_seconds=float(values.get("WORKER_HEARTBEAT_SECONDS", "10")),
        dummy=values.get("WORKER_DUMMY", "") == "1",
        values=values,
    )
