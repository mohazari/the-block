"""The data epoch on every API response.

The server performs every reseed itself (at startup, or `npm run reset-db` through
routers/dev.py; serverlock.py stops anything else resetting the file under it), so the epoch in
`app.state.data_epoch` is always exact. Live streams carry it in their hello; this header covers
a tab whose stream is down or reconnecting.
"""

from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

HEADER = "X-Data-Epoch"


def current_epoch(app: Any) -> str | None:
    return getattr(app.state, "data_epoch", None)


class DataEpochHeader:
    """Pure ASGI on purpose: `@app.middleware` would route the long-lived event stream through
    BaseHTTPMiddleware's buffering."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            await self.app(scope, receive, send)
            return

        async def stamped(message: Message) -> None:
            epoch = current_epoch(scope["app"])  # read when the response starts, not before
            if message["type"] == "http.response.start" and epoch is not None:
                headers = list(message.get("headers", []))
                headers.append((HEADER.lower().encode(), epoch.encode()))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, stamped)
