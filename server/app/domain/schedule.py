"""Mapping the dataset's synthetic auction times onto the present.

The provided `auction_start` values are fixed calendar dates (a one-week window in spring 2026),
so taken literally every auction is in the past. We keep the dataset's *relative* schedule —
which lane opens before which, and by how much — and shift the whole week so the first auction
is about to close when the server starts. With 4-day auctions that yields a realistic mix of
roughly 55% live and 45% upcoming inventory.
"""

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta

AUCTION_DURATION = timedelta(days=4)

# How long after startup the earliest auction closes — long enough to explore, short enough that
# a demo shows a countdown reaching zero.
FIRST_CLOSE_LEAD = timedelta(minutes=20)


def parse_dataset_time(value: str) -> datetime:
    """Dataset times are naive local times; treat them as UTC so all arithmetic is tz-aware."""
    parsed = datetime.fromisoformat(value)
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def schedule_shift(
    dataset_starts: Iterable[datetime],
    now: datetime,
    duration: timedelta = AUCTION_DURATION,
    first_close_lead: timedelta = FIRST_CLOSE_LEAD,
) -> timedelta:
    """Offset to add to every dataset start time.

    Rounded to whole minutes so countdowns land on clean boundaries.
    """
    earliest = min(dataset_starts)
    shift = (now + first_close_lead - duration) - earliest
    return timedelta(minutes=round(shift / timedelta(minutes=1)))
