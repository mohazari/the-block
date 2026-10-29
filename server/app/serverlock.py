"""One process at a time per database file.

A running server holds an exclusive OS lock on `<database>.server` (the OS releases it even if
the process dies), and so does `npm run reset-db` while it resets. So the data can never be
reset under a running server, which would keep serving its old epoch and live streams, and two
servers can't share a database either. Data changes only between server runs; a restarted
server reads the new epoch and every tab resyncs when its stream reconnects.
"""

import os
import sys
import threading
import time
from pathlib import Path
from typing import IO

from sqlalchemy import make_url

# How long a starting server waits for the lock: `reset-db` holds it for a second or so, and a
# --reload worker can briefly overlap the one it replaces.
WAIT_FOR_LOCK_SECONDS = 15.0
LOCK_SUFFIX = ".server"


def lock_path(database_url: str) -> Path | None:
    """The lock file for this database: one per real file, however the URL spells the path."""
    database = make_url(database_url).database
    if not database or database == ":memory:":
        return None
    file = Path(database).resolve()
    return file.with_name(f"{file.name}{LOCK_SUFFIX}")


def _try_lock(file: IO[bytes]) -> bool:
    if sys.platform == "win32":
        import msvcrt

        try:
            msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            return False
        return True
    import fcntl

    try:
        fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return False
    return True


class DatabaseLock:
    def __init__(self, path: Path | None) -> None:
        self._path = path
        self._file: IO[bytes] | None = None

    def try_acquire(self) -> bool:
        if self._path is None:  # in-memory database: nothing to share
            return True
        file = os.fdopen(os.open(self._path, os.O_RDWR | os.O_CREAT, 0o600), "r+b")
        if not _try_lock(file):
            file.close()
            return False
        self._file = file
        return True

    @property
    def database_name(self) -> str:
        return self._path.name.removesuffix(LOCK_SUFFIX) if self._path else "the database"

    def acquire(self, wait: float, give_up: threading.Event | None = None) -> None:
        """Blocking (polls): call it off the event loop. `give_up` stops the wait early."""
        deadline = time.monotonic() + wait
        while not self.try_acquire():
            if give_up is not None and give_up.is_set():
                return
            if time.monotonic() > deadline:
                raise RuntimeError(
                    f"{self.database_name} is in use by another server or a reset still "
                    "running. Stop the other server (or wait for the reset), then start this "
                    "one again."
                )
            time.sleep(0.1)

    def release(self) -> None:
        if self._file is not None:
            self._file.close()  # closing releases the lock
            self._file = None
