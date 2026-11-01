"""What the worker reports about this computer in its heartbeat: GPU and free disk."""

from __future__ import annotations

import shutil
import subprocess

from .config import REPO_DIR


def gpu_summary() -> str | None:
    try:
        output = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.used,memory.total,utilization.gpu", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    if not output:
        return None
    name, used, total, utilization = [part.strip() for part in output.splitlines()[0].split(",")]
    return f"{name}: {used}/{total} MiB, {utilization}% busy"


def free_disk_gb() -> float:
    return round(shutil.disk_usage(REPO_DIR).free / 1e9, 1)
