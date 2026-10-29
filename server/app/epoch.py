"""Noticing a reseed under a running server.

`npm run reset-db` rewrites the database from another process. Bid counts restart, so clients
must drop what they cached — but an idle tab makes no requests to learn about it. The server
keeps the current data epoch in memory, checks the database for a new one every few seconds
(off the event loop), and on a change ends every live stream: browsers reconnect within seconds
and their hello carries the new epoch.
"""

import asyncio
import logging
import time
from collections.abc import Callable

from sqlalchemy import Engine
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.seed import data_epoch

logger = logging.getLogger(__name__)

CHECK_EVERY_SECONDS = 2.0


class EpochWatcher:
    def __init__(
        self,
        engine: Engine,
        on_change: Callable[[str], None],
        listeners: Callable[[], int] = lambda: 0,
    ) -> None:
        self._engine = engine
        self._on_change = on_change
        self._listeners = listeners
        self._lock = asyncio.Lock()  # concurrent requests share one check
        self.current = data_epoch(engine)
        self._checked_at = time.monotonic()

    def check(self) -> str | None:
        """The epoch now in the database if it differs from `current`, else None.

        Blocking, so it runs in a worker thread — and it only reads: `current` changes on the
        event loop, together with ending the streams.
        """
        latest = data_epoch(self._engine)
        return latest if latest != self.current else None

    def is_stale(self) -> bool:
        """Not checked within the last interval (the loop idles when no stream is open).

        So an epoch is at most CHECK_EVERY_SECONDS old, idle or not: a reseed shows up in the
        first response after that. Checking on literally every request would put a database
        read in front of each one, which this design exists to avoid.
        """
        return time.monotonic() - self._checked_at > CHECK_EVERY_SECONDS

    async def refresh(self) -> None:
        """Check now, off the event loop, and apply the result on it. Raises if the read fails
        (nothing is marked checked, so the next caller tries again)."""
        async with self._lock:
            check = asyncio.ensure_future(asyncio.to_thread(self.check))
            try:
                latest = await asyncio.shield(check)
            except asyncio.CancelledError:
                # Shutting down: let a read in progress finish before the engine is disposed.
                await asyncio.gather(check, return_exceptions=True)
                raise
            self._checked_at = time.monotonic()
            if latest is None:
                return
            logger.info("Data was reseeded: ending live streams so clients resync")
            # Back to back on the event loop: no client can receive a hello with the new epoch
            # and then have that same stream closed (it would resync twice).
            self.current = latest
            try:
                self._on_change(latest)
            except Exception:  # a failing callback must not stop future checks
                logger.exception("Ending live streams after a reseed failed")

    async def run(self) -> None:
        """Keep open streams' clients current. With no stream open, do nothing: requests
        refresh on demand instead (see DataEpochHeader)."""
        while True:
            await asyncio.sleep(CHECK_EVERY_SECONDS)
            if not self._listeners():
                continue
            try:
                await self.refresh()
            except asyncio.CancelledError:
                raise
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

        watcher = getattr(scope["app"].state, "epoch", None)
        if watcher is not None and watcher.is_stale():
            # The loop was idle: check before answering, so this response can't carry an epoch
            # older than the data it's built from.
            try:
                await watcher.refresh()
            except Exception:
                logger.exception("Data epoch check failed")

        async def stamped(message: Message) -> None:
            if message["type"] == "http.response.start" and watcher is not None:
                headers = list(message.get("headers", []))
                headers.append((b"x-data-epoch", watcher.current.encode()))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, stamped)
