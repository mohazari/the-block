"""Development entrypoint: `python -m app.serve [--reload] [--port 8000]`.

Logging is configured here rather than on import, so importing the app (tests, tools) has no
side effects.
"""

import argparse
import logging

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    # uvicorn only configures its own loggers; surface ours (seeding, simulator) next to them.
    logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(name)s - %(message)s")
    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        # Open SSE streams never finish on their own; don't let them block Ctrl-C or a reload.
        timeout_graceful_shutdown=2,
    )


if __name__ == "__main__":
    main()
