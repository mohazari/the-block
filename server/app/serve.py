"""Development entrypoint: `python -m app.serve [--reload] [--port 8000]`.

Logging goes through uvicorn's own config, so it also applies to the worker process that
`--reload` spawns (a plain `basicConfig` here would only configure the watcher process).
"""

import argparse
import copy
import os
from typing import Any

import uvicorn
from uvicorn.config import LOGGING_CONFIG


def log_config() -> dict[str, Any]:
    """uvicorn's defaults, plus our `app.*` loggers (seeding, simulator) in the same format."""
    config: dict[str, Any] = copy.deepcopy(LOGGING_CONFIG)
    config["loggers"]["app"] = {"handlers": ["default"], "level": "INFO", "propagate": False}
    return config


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    parser.add_argument(
        "--allow-dev-reset",
        action="store_true",
        help="mount POST /api/dev/reset, so `npm run reset-db` can reseed the running server",
    )
    args = parser.parse_args()
    if args.allow_dev_reset:
        os.environ["ALLOW_DEV_RESET"] = "1"  # inherited by the --reload worker process

    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        # Watch only the code: the SQLite files next to it change on every bid.
        reload_dirs=["app"] if args.reload else None,
        log_config=log_config(),
        # Open SSE streams never finish on their own; don't let them block Ctrl-C or a reload.
        timeout_graceful_shutdown=2,
    )


if __name__ == "__main__":
    main()
