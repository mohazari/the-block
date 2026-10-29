"""Noticing a reseed under a running server.

`npm run reset-db` rewrites the database from another process. Bid counts restart, so clients
must drop what they cached — but an idle tab makes no requests to learn about it. The server
keeps the current data epoch in memory, checks the database for a new one every few seconds
(off the event loop), and on a change ends every live stream: browsers reconnect within seconds
and their hello carries the new epoch.
"""

import asyncio
import logging
from collections.abc import Callable

from sqlalchemy import Engine
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.seed import data_epoch

logger = logging.getLogger(__name__)

CHECK_EVERY_SECONDS = 2.0


class EpochWatcher:
    def __init__(self, engine: Engine, on_change: Callable[[str], None]) -> None:
        self._engine = engine
        self._on_change = on_change
        self.current = data_epoch(engine)

    def check(self) -> bool:
        """Re-read the epoch; returns whether it changed. Blocking: run it off the event loop."""
        latest = data_epoch(self._engine)
        if latest == self.current:
            return False
        logger.info("Data was reseeded: ending live streams so clients resync")
        self.current = latest
        return True

    async def run(self) -> None:
        while True:
            await asyncio.sleep(CHECK_EVERY_SECONDS)
            try:
                if await asyncio.to_thread(self.check):
                    self._on_change(self.current)
            except Exception:  # a failed check must not stop future ones
                logger.exception("Data epoch check failed")


class DataEpochHeader:
    """Stamps `X-Data-Epoch` on API responses, from memory (the watcher keeps it current).

    A client whose live stream is down — or in the seconds before it reconnects after a reseed —
    still learns about a reseed from any response. Pure ASGI on purpose: `@app.middleware`
    would route the long-lived event stream through BaseHTTPMiddleware's buffering.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            await self.app(scope, receive, send)
            return

        async def stamped(message: Message) -> None:
            watcher = getattr(scope["app"].state, "epoch", None)
            if message["type"] == "http.response.start" and watcher is not None:
                headers = list(message.get("headers", []))
                headers.append((b"x-data-epoch", watcher.current.encode()))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, stamped)
