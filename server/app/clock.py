"""The server owns time.

Every auction state is derived from timestamps compared against `Clock.now()`. Injecting the
clock lets tests freeze or advance time instead of sleeping.
"""

from datetime import UTC, datetime, timedelta
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime: ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class FrozenClock:
    def __init__(self, at: datetime) -> None:
        self._at = at

    def now(self) -> datetime:
        return self._at

    def advance(self, delta: timedelta) -> None:
        self._at += delta
