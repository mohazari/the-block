"""Which server, if any, is using a database file.

A running server holds an exclusive OS lock on `<database>.server` (the OS releases it even if
the process dies), with its address and a reset token written inside. So `npm run reset-db` can
tell — however the path is spelled, whatever port the server uses — whether to reset the file
itself or ask that server to, and it can never reseed under a server that wouldn't notice. Two
servers can't share a database either: each would keep its own epoch and live streams.
"""

import json
import os
import secrets
import time
from dataclasses import dataclass
from pathlib import Path
from typing import IO

from sqlalchemy import make_url

try:
    import fcntl
except ImportError:  # pragma: no cover - Windows: no locking, reset-db resets the file directly
    fcntl = None  # type: ignore[assignment]

# How long a starting server waits for the lock: `reset-db` holds it for a second while it
# resets, and a --reload worker can briefly overlap the previous one.
WAIT_FOR_LOCK_SECONDS = 15.0


def lock_path(database_url: str) -> Path | None:
    """The lock file for this database: one per real file, however the URL spells the path."""
    database = make_url(database_url).database
    if not database or database == ":memory:":
        return None
    file = Path(database).resolve()
    return file.with_name(f"{file.name}.server")


@dataclass(frozen=True)
class ServerInfo:
    host: str
    port: int | None
    token: str


class DatabaseLock:
    def __init__(self, path: Path | None) -> None:
        self._path = path
        self._file: IO[str] | None = None

    def try_acquire(self) -> bool:
        if self._path is None or fcntl is None:
            return True
        # Owner-only: the token inside lets whoever reads it reset the data.
        file = os.fdopen(os.open(self._path, os.O_RDWR | os.O_CREAT, 0o600), "r+")
        try:
            fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            file.close()
            return False
        self._file = file
        return True

    def acquire(self, wait: float) -> None:
        deadline = time.monotonic() + wait
        while not self.try_acquire():
            if time.monotonic() > deadline:
                raise RuntimeError(
                    f"Another server is already using {self._path and self._path.stem}. "
                    "Stop it first: two servers on one database would each miss the other's "
                    "bids and resets."
                )
            time.sleep(0.1)

    def publish(self, info: ServerInfo) -> None:
        if self._file is None:
            return
        self._file.seek(0)
        self._file.truncate()
        json.dump({"host": info.host, "port": info.port, "token": info.token}, self._file)
        self._file.flush()

    def release(self) -> None:
        if self._file is not None:
            self._file.truncate(0)
            self._file.close()  # closing releases the lock
            self._file = None


def hold_for_server(database_url: str) -> tuple[DatabaseLock, str]:
    """Lock the database for this server's lifetime; returns the lock and a fresh reset token."""
    lock = DatabaseLock(lock_path(database_url))
    lock.acquire(WAIT_FOR_LOCK_SECONDS)
    token = secrets.token_urlsafe(32)
    port = os.environ.get("THE_BLOCK_PORT")  # set by app.serve
    lock.publish(
        ServerInfo(
            host=os.environ.get("THE_BLOCK_HOST", "127.0.0.1"),
            port=int(port) if port else None,
            token=token,
        )
    )
    return lock, token


def read_server_info(path: Path, wait: float = 5.0) -> ServerInfo | None:
    """What the server holding the lock published (it writes right after locking)."""
    deadline = time.monotonic() + wait
    while True:
        try:
            data = json.loads(path.read_text() or "null")
        except (OSError, json.JSONDecodeError):
            data = None
        if data:
            return ServerInfo(host=data["host"], port=data["port"], token=data["token"])
        if time.monotonic() > deadline:
            return None
        time.sleep(0.1)
