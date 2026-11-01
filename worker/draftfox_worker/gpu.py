"""Holding the graphics card while a stage uses it. Draftfox keeps the lease (see src/lib/gpu-lock.ts): requests from
the app go first, so the worker waits for them and gives the card back as soon as its GPU work is done."""

from __future__ import annotations

import logging
import threading
from collections.abc import Iterator
from contextlib import contextmanager

from .context import StageContext

log = logging.getLogger("worker.gpu")

TTL_SECONDS = 300
RENEW_SECONDS = 60


@contextmanager
def gpu_lease(ctx: StageContext, purpose: str, uses: str = "") -> Iterator[None]:
    """`uses="comfyui"` unloads Ollama's models first and frees ComfyUI's memory afterwards."""
    told = False
    while True:
        ctx.check()
        answer = ctx.client.gpu("acquire", purpose, uses, wait_seconds=20, ttl_seconds=TTL_SECONDS)
        if answer.get("granted"):
            break
        if not told:
            holder = (answer.get("lease") or {}).get("purpose", "another task")
            ctx.progress(ctx.job.get("progress") or 0, f"Waiting for the graphics card ({holder})")
            told = True
    log.info("GPU lease taken for %s", purpose)

    done = threading.Event()

    def renew() -> None:
        while not done.wait(RENEW_SECONDS):
            try:
                ctx.client.gpu("renew", purpose, ttl_seconds=TTL_SECONDS)
            except Exception as error:  # noqa: BLE001 - the lease just expires if this keeps failing
                log.warning("Couldn't renew the GPU lease: %s", error)

    thread = threading.Thread(target=renew, daemon=True)
    thread.start()
    try:
        yield
    finally:
        done.set()
        try:
            ctx.client.gpu("release", purpose, uses)
        except Exception as error:  # noqa: BLE001 - it expires on its own
            log.warning("Couldn't release the GPU lease: %s", error)
        log.info("GPU lease released after %s", purpose)
