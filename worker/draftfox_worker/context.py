"""What a stage gets: the job, its folder, and ways to report progress, save files and notice a cancel."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .client import DraftfoxClient
from .config import Config


class StageError(Exception):
    """A stage failed. With retryable=False the job fails at once instead of being tried again."""

    def __init__(self, message: str, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable


class Stopped(Exception):
    """The job was cancelled or taken away while a stage ran."""


@dataclass
class StageContext:
    config: Config
    client: DraftfoxClient
    job: dict[str, Any]
    stage: str
    dir: Path
    stop: threading.Event = field(default_factory=threading.Event)

    @property
    def job_id(self) -> str:
        return self.job["id"]

    def check(self) -> None:
        if self.stop.is_set():
            raise Stopped()

    def progress(self, value: float, message: str | None = None) -> None:
        self.check()
        self.client.progress(self.job_id, value, message)

    def warn(self, value: float, message: str) -> None:
        """Like progress, but the message is logged as a warning in the job's events."""
        self.check()
        self.client.progress(self.job_id, value, message, level="warn")

    def save_asset(self, name: str, path: Path) -> None:
        """Records a finished file so a restart reuses it instead of making it again."""
        self.client.register_asset(self.job_id, name, str(path))
        files = self.job.setdefault("assets", {}).setdefault("files", {})
        files[name] = path.relative_to(self.dir).as_posix()

    def existing_asset(self, name: str) -> Path | None:
        """A file an earlier, interrupted run of this stage already made, if it's still there."""
        relative = (self.job.get("assets") or {}).get("files", {}).get(name)
        if not relative:
            return None
        path = self.dir / relative
        return path if path.is_file() and path.stat().st_size > 0 else None
