"""The data epoch on every API response.

The data only changes between server runs (serverlock.py stops `reset-db` resetting it under a
running server), so `app.state.data_epoch`, read at startup, is always exact. Live streams carry
it in their hello; this header covers a tab whose stream is down or reconnecting.
"""

from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

HEADER = "X-Data-Epoch"


def epoch_for(app: Any, path: str) -> str | None:
    """The epoch to stamp on a response to `path`, if any (API responses only)."""
    return getattr(app.state, "data_epoch", None) if path.startswith("/api/") else None


class DataEpochHeader:
    """Pure ASGI on purpose: `@app.middleware` would route the long-lived event stream through
    BaseHTTPMiddleware's buffering."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def stamped(message: Message) -> None:
            epoch = epoch_for(scope["app"], scope["path"])
            if message["type"] == "http.response.start" and epoch is not None:
                headers = list(message.get("headers", []))
                headers.append((HEADER.lower().encode(), epoch.encode()))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, stamped)
