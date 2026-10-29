"""Load data/vehicles.json into SQLite.

Run `python -m app.seed --reset` (or `npm run reset-db`) to start over with a fresh clock.
"""

import argparse
import json
import logging
import random
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from app.clock import SystemClock
from app.config import Settings
from app.db import create_db_engine
from app.domain.bidders import RIVAL_BIDDER_IDS
from app.domain.schedule import AUCTION_DURATION, parse_dataset_time, schedule_shift
from app.models import Base, Bid, Meta, Vehicle

logger = logging.getLogger(__name__)

# Fixed seed: the synthesized bid history is identical on every run.
_HISTORY_SEED = 42
_HISTORY_WINDOW = timedelta(hours=36)
_SEARCH_FIELDS = (
    "year", "make", "model", "trim", "body_style", "exterior_color", "fuel_type", "drivetrain",
    "vin", "lot", "selling_dealership", "city", "province",
)  # fmt: skip
_COPIED_FIELDS = (
    "id", "lot", "vin", "year", "make", "model", "trim", "body_style", "exterior_color",
    "interior_color", "engine", "transmission", "drivetrain", "fuel_type", "odometer_km",
    "condition_grade", "condition_report", "damage_notes", "title_status", "province", "city",
    "selling_dealership", "images", "starting_bid", "reserve_price", "buy_now_price",
    "current_bid", "bid_count",
)  # fmt: skip


def search_text(record: dict[str, Any]) -> str:
    return " ".join(str(record[field]) for field in _SEARCH_FIELDS).lower()


def synthesize_history(
    rng: random.Random, starting_bid: int, current_bid: int, bid_count: int, now: datetime
) -> list[tuple[str, int, datetime]]:
    """Plausible (bidder, amount, time) history ending exactly at the dataset's current bid.

    The dataset has `bid_count` and `current_bid` but no history; without one, the detail page
    would show "16 bids" next to an empty list. Amounts climb from the starting bid, times are
    spread over the last day and a half, and consecutive bids come from different rivals.
    """
    if bid_count == 1:
        amounts = [current_bid]
    else:
        span = current_bid - starting_bid
        amounts = [
            starting_bid + span * i // (bid_count - 1) // 25 * 25 for i in range(bid_count - 1)
        ]
        amounts.append(current_bid)

    window_seconds = int(_HISTORY_WINDOW.total_seconds())
    times = sorted(
        now - timedelta(seconds=rng.randint(120, window_seconds)) for _ in range(bid_count)
    )

    history: list[tuple[str, int, datetime]] = []
    previous: str | None = None
    for amount, placed_at in zip(amounts, times, strict=True):
        bidder = rng.choice([b for b in RIVAL_BIDDER_IDS if b != previous])
        history.append((bidder, amount, placed_at))
        previous = bidder
    return history


def seed(session: Session, data_path: Path, now: datetime) -> int:
    records: list[dict[str, Any]] = json.loads(data_path.read_text())
    shift = schedule_shift((parse_dataset_time(r["auction_start"]) for r in records), now)
    rng = random.Random(_HISTORY_SEED)

    for record in records:
        starts_at = parse_dataset_time(record["auction_start"]) + shift
        history = (
            synthesize_history(
                rng, record["starting_bid"], record["current_bid"], record["bid_count"], now
            )
            if record["current_bid"] is not None
            else []
        )
        vehicle = Vehicle(
            **{key: record[key] for key in _COPIED_FIELDS},
            starts_at=starts_at,
            ends_at=starts_at + AUCTION_DURATION,
            high_bidder_id=history[-1][0] if history else None,
            search_text=search_text(record),
        )
        vehicle.bids = [
            Bid(bidder_id=bidder, amount=amount, placed_at=placed_at)
            for bidder, amount, placed_at in history
        ]
        session.add(vehicle)

    session.add_all(
        [
            Meta(key="seeded_at", value=now.isoformat()),
            Meta(key="schedule_shift_minutes", value=str(int(shift / timedelta(minutes=1)))),
        ]
    )
    return len(records)


def needs_seed(session: Session, now: datetime) -> bool:
    """Seed when empty, or when every auction has closed (e.g. cloned and run a week later)."""
    open_auctions = session.scalar(
        select(func.count()).select_from(Vehicle).where(Vehicle.ends_at > now)
    )
    return not open_auctions


def ensure_seeded(engine: Engine, data_path: Path, now: datetime) -> None:
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        if not needs_seed(session, now):
            return
    reset(engine, data_path, now)


def reset(engine: Engine, data_path: Path, now: datetime) -> None:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with Session(engine) as session, session.begin():
        count = seed(session, data_path, now)
    logger.info("Seeded %d vehicles from %s", count, data_path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="drop all data and reseed")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    settings = Settings.from_env()
    engine = create_db_engine(settings.database_url)
    now = SystemClock().now()
    if args.reset:
        reset(engine, settings.data_path, now)
    else:
        ensure_seeded(engine, settings.data_path, now)


if __name__ == "__main__":
    main()
