"""The worker loop: claim a job, run its unfinished stages in order, report each one, repeat.
A background thread sends a heartbeat every few seconds; it keeps the job's lease and notices a cancel."""

from __future__ import annotations

import logging
import threading
import time
import traceback
from pathlib import Path
from typing import Any

from . import VERSION
from .client import ApiError, DraftfoxClient
from .config import Config
from .context import StageContext, StageError, Stopped
from .stages import stage_for
from .system import free_disk_gb, gpu_summary

log = logging.getLogger("worker")

# Pause after a failed stage before claiming again, so a broken job doesn't spin.
FAILURE_PAUSE_SECONDS = 15


class Worker:
    def __init__(self, config: Config):
        self.config = config
        self.client = DraftfoxClient(config)
        self.current: StageContext | None = None
        self.quit = threading.Event()

    # --- Heartbeat ---

    def _beat(self) -> None:
        ctx = self.current
        try:
            answer = self.client.heartbeat(
                jobId=ctx.job_id if ctx else None,
                stage=ctx.stage if ctx else None,
                gpu=gpu_summary(),
                freeDiskGb=free_disk_gb(),
                version=VERSION,
            )
            if ctx and answer.get("stop"):
                log.warning("Draftfox says to stop job %s (cancelled or reassigned)", ctx.job_id)
                ctx.stop.set()
        except Exception as error:  # noqa: BLE001 - the heartbeat must never kill the worker
            log.warning("Heartbeat failed: %s", error)

    def _heartbeat_loop(self) -> None:
        while not self.quit.wait(self.config.heartbeat_seconds):
            self._beat()

    # --- Jobs ---

    def run_job(self, job: dict[str, Any], stage: str | None, directory: str) -> None:
        use_dummy = self.config.dummy or job["topic"].lower().startswith("test:")
        while stage:
            ctx = StageContext(self.config, self.client, job, stage, Path(directory))
            self.current = ctx
            log.info("Job %s: %s stage%s", job["id"], stage, " (dummy)" if use_dummy else "")
            started = time.monotonic()
            failure: tuple[str, bool] | None = None
            try:
                result = stage_for(stage, use_dummy)(ctx)
                ctx.check()
            except Stopped:
                log.info("Job %s stopped during %s", job["id"], stage)
                return
            except ApiError as error:
                if error.status in (404, 409):
                    # Cancelled, deleted or given to another worker while the stage ran.
                    log.info("Job %s stopped during %s: %s", job["id"], stage, error.message)
                    return
                log.error("Job %s: Draftfox refused an update at %s: %s", job["id"], stage, error)
                failure = (f"Draftfox refused an update: {error}", True)
            except StageError as error:
                log.error("Job %s failed at %s: %s", job["id"], stage, error)
                failure = (str(error), error.retryable)
            except Exception as error:  # noqa: BLE001 - any crash in a stage fails the stage, not the worker
                log.error("Job %s crashed at %s:\n%s", job["id"], stage, traceback.format_exc())
                failure = (f"{type(error).__name__}: {error}", True)
            finally:
                self.current = None
            if failure:
                self._fail(job["id"], stage, *failure)
                return
            seconds = time.monotonic() - started
            answer = self.client.complete_stage(job["id"], stage, result, seconds)
            log.info("Job %s: %s done in %.1f s", job["id"], stage, seconds)
            job, stage = answer["job"], answer.get("stage")
        log.info("Job %s is ready for review", job["id"])

    def _fail(self, job_id: str, stage: str, message: str, retryable: bool) -> None:
        try:
            self.client.fail_stage(job_id, stage, message, retryable)
        except ApiError as error:
            log.warning("Couldn't report the failure: %s", error)
        self.quit.wait(FAILURE_PAUSE_SECONDS)

    def run(self, once: bool = False) -> None:
        log.info("Worker %s %s talking to %s", self.config.worker_id, VERSION, self.config.draftfox_url)
        self._beat()
        threading.Thread(target=self._heartbeat_loop, daemon=True).start()
        while not self.quit.is_set():
            try:
                answer = self.client.claim()
            except Exception as error:  # noqa: BLE001 - Draftfox restarting or not up yet
                log.warning("Couldn't reach Draftfox: %s", error)
                self.quit.wait(max(self.config.poll_seconds, 10))
                continue
            job = answer.get("job")
            if not job:
                if once:
                    return
                self.quit.wait(self.config.poll_seconds)
                continue
            try:
                self.run_job(job, answer.get("stage"), answer["dir"])
            except ApiError as error:
                # 409/404: the job was cancelled, deleted or reassigned between calls.
                log.warning("Job %s: %s", job["id"], error)
            except Exception as error:  # noqa: BLE001
                log.error("Lost contact while working on %s: %s", job["id"], error)
                self.quit.wait(10)
            if once:
                return
