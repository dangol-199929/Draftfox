"""Starts the Draftfox video worker.

    worker\\.venv\\Scripts\\python worker\\worker.py          run until stopped
    worker\\.venv\\Scripts\\python worker\\worker.py --once   do one job (or nothing) and exit
"""

from __future__ import annotations

import argparse
import logging
import sys

from draftfox_worker.config import load_config
from draftfox_worker.runner import Worker


def main() -> None:
    parser = argparse.ArgumentParser(description="Draftfox video worker")
    parser.add_argument("--once", action="store_true", help="run at most one job, then exit")
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stdout,
    )
    # Windows consoles default to a legacy code page; topics can hold any character.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    try:
        Worker(load_config()).run(once=args.once)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
