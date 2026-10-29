"""The data epoch and server run on every API response.

The data only changes between server runs (serverlock.py stops `reset-db` resetting it under a
running server), so `app.state.data_epoch`, read at startup, is exact for the whole run. Each
run also has a random id: a client can then tell a late response from a previous run (ignore
it) from a new run (adopt it, and drop its cache if the epoch differs) without comparing clocks.
Live streams carry both in their hello; these headers cover a tab whose stream is down.
"""

from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

EPOCH_HEADER = "X-Data-Epoch"
RUN_HEADER = "X-Server-Run"


def is_api(path: str) -> bool:
    return path.startswith("/api/")


def epoch_headers(app: Any) -> list[tuple[str, str]]:
    """The headers to stamp on an API response (none before startup has finished)."""
    epoch = getattr(app.state, "data_epoch", None)
    run = getattr(app.state, "run_id", None)
    if epoch is None or run is None:
        return []
    return [(EPOCH_HEADER, epoch), (RUN_HEADER, run)]


class DataEpochHeader:
    """Pure ASGI on purpose: `@app.middleware` would route the long-lived event stream through
    BaseHTTPMiddleware's buffering."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not is_api(scope["path"]):
            await self.app(scope, receive, send)
            return

        async def stamped(message: Message) -> None:
            if message["type"] == "http.response.start":  # not on every body chunk
                headers = list(message.get("headers", []))
                headers += [
                    (k.lower().encode(), v.encode()) for k, v in epoch_headers(scope["app"])
                ]
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, stamped)
