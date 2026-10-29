"""SQLite engine setup.

Python's sqlite3 driver manages transactions on its own and only takes SQLite's write lock at the
first write. For bids we need the lock *before* we read the current price, otherwise two bidders
can both read $20,000 and both "win". So we turn off the driver's handling and issue BEGIN
ourselves: DEFERRED for normal work, IMMEDIATE (take the write lock up front) for sessions bound
via `write_engine()`. In Postgres the equivalent would be `SELECT ... FOR UPDATE`.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from sqlite3 import Connection as SQLiteConnection
from typing import Any

from sqlalchemy import DateTime, Engine, create_engine, event
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.types import TypeDecorator

_BEGIN_MODE_OPTION = "sqlite_begin_mode"


class UTCDateTime(TypeDecorator[datetime]):
    """SQLite has no timezone type: store naive UTC, hand back aware UTC."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Any) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("naive datetimes are not allowed; pass a UTC-aware value")
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect: Any) -> datetime | None:
        return None if value is None else value.replace(tzinfo=UTC)


def create_db_engine(url: str) -> Engine:
    engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 10})

    @event.listens_for(engine, "connect")
    def _on_connect(dbapi_connection: SQLiteConnection, _record: Any) -> None:
        dbapi_connection.isolation_level = None  # we emit BEGIN ourselves (see module doc)
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")  # readers never block the writer
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    @event.listens_for(engine, "begin")
    def _on_begin(connection: Connection) -> None:
        mode = connection.get_execution_options().get(_BEGIN_MODE_OPTION, "DEFERRED")
        connection.exec_driver_sql(f"BEGIN {mode}")

    return engine


def write_engine(engine: Engine) -> Engine:
    """Same pool, but every transaction starts with BEGIN IMMEDIATE."""
    return engine.execution_options(**{_BEGIN_MODE_OPTION: "IMMEDIATE"})


@contextmanager
def session_scope(factory: sessionmaker[Session]) -> Iterator[Session]:
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
