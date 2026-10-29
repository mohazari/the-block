"""Load data/vehicles.json into SQLite.

Run `python -m app.seed --reset` (or `npm run reset-db`) to start over with a fresh clock.
"""

import argparse
import json
import logging
import os
import random
import re
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import Connection, Engine, func, inspect, select
from sqlalchemy.orm import Session

from app.clock import SystemClock
from app.config import Settings
from app.db import create_db_engine, write_engine
from app.domain.auction import min_next_bid
from app.domain.bidders import RIVAL_BIDDER_IDS
from app.domain.schedule import AUCTION_DURATION, parse_dataset_time, schedule_shift
from app.models import Base, Bid, Meta, Vehicle

logger = logging.getLogger(__name__)

# Bump whenever the models change: an existing dev database is then rebuilt automatically.
SCHEMA_VERSION = "4"

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
    "current_bid",
)  # fmt: skip


def search_text(record: dict[str, Any]) -> str:
    """Lower-cased searchable words. Punctuated words are also stored split apart, so word-start
    search finds "0043" in lot A-0043, "150" in F-150 and "benz" in Mercedes-Benz."""
    text = " ".join(str(record[field]) for field in _SEARCH_FIELDS).lower()
    split = re.sub(r"[^a-z0-9]+", " ", text)
    return text if split == text else f"{text} {split}"


def ladder_amounts(
    rng: random.Random, starting_bid: int, current_bid: int, bid_count: int
) -> list[int]:
    """Bid amounts that obey the increment ladder and end exactly at `current_bid`.

    Every amount reachable by valid minimum raises from the starting bid is a candidate; any
    ascending subset of them is itself a valid ladder (skipping steps only widens the gaps).

    The dataset's `bid_count` cannot always be honoured — 34 vehicles claim more bids than fit
    between their starting and current bid (e.g. 11 bids within $500). Then the history keeps
    as many valid bids as fit, and the stored bid count follows the history.
    """
    candidates: list[int] = []
    amount = starting_bid
    while min_next_bid(starting_bid, amount) <= current_bid:
        candidates.append(amount)
        amount = min_next_bid(starting_bid, amount)

    earlier = min(bid_count - 1, len(candidates))
    return [*sorted(rng.sample(candidates, earlier)), current_bid]


def synthesize_history(
    rng: random.Random, starting_bid: int, current_bid: int, bid_count: int, now: datetime
) -> list[tuple[str, int, datetime]]:
    """Plausible (bidder, amount, time) history for a vehicle that already has bids.

    The dataset has `bid_count` and `current_bid` but no history; without one the detail page
    would show "16 bids" next to an empty list. Times are spread over the last day and a half
    and consecutive bids come from different rivals.
    """
    amounts = ladder_amounts(rng, starting_bid, current_bid, bid_count)
    window_seconds = int(_HISTORY_WINDOW.total_seconds())
    times = sorted(
        now - timedelta(seconds=rng.randint(120, window_seconds)) for _ in range(len(amounts))
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
    dataset_starts = [parse_dataset_time(r["auction_start"]) for r in records]
    shift = schedule_shift(dataset_starts, now)
    rng = random.Random(_HISTORY_SEED)

    for record, dataset_start in zip(records, dataset_starts, strict=True):
        starts_at = dataset_start + shift
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
            bid_count=len(history),
            high_bidder_id=history[-1][0] if history else None,
            search_text=search_text(record),
        )
        numbers: dict[str, int] = {}  # paddle numbers in order of first bid
        vehicle.bids = [
            Bid(
                bidder_id=bidder,
                bidder_number=numbers.setdefault(bidder, len(numbers) + 1),
                amount=amount,
                placed_at=placed_at,
            )
            for bidder, amount, placed_at in history
        ]
        session.add(vehicle)

    session.add_all(
        [
            Meta(key="schema_version", value=SCHEMA_VERSION),
            Meta(key="seeded_at", value=now.isoformat()),
            Meta(key="schedule_shift_minutes", value=str(int(shift / timedelta(minutes=1)))),
        ]
    )
    return len(records)


def data_epoch(engine: Engine) -> str:
    """Identifies this copy of the data: changes whenever the database is (re)seeded."""
    with Session(engine) as session:
        seeded_at = session.get(Meta, "seeded_at")
        return seeded_at.value if seeded_at else ""


def needs_seed(session: Session, now: datetime) -> bool:
    """Seed when empty, built by an older schema, or every auction has closed.

    The last case covers a reviewer cloning the repo and running it a week later.
    """
    if not inspect(session.connection()).has_table(Meta.__tablename__):
        return True
    version = session.get(Meta, "schema_version")
    if version is None or version.value != SCHEMA_VERSION:
        return True
    open_auctions = session.scalar(
        select(func.count()).select_from(Vehicle).where(Vehicle.ends_at > now)
    )
    return not open_auctions


def _rebuild(connection: Connection, data_path: Path, now: datetime) -> int:
    Base.metadata.drop_all(connection)
    Base.metadata.create_all(connection)
    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        count = seed(session, data_path, now)
        session.commit()  # releases the savepoint into the outer transaction; it commits there
    return count


def ensure_seeded(engine: Engine, data_path: Path, now: datetime) -> bool:
    """Seed if needed. Returns True when the database was (re)built.

    Check and rebuild run in one BEGIN IMMEDIATE transaction — SQLite DDL is transactional — so
    two processes starting together cannot both rebuild, and a failed seed leaves the previous
    data intact.
    """
    with write_engine(engine).begin() as connection:
        with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
            if not needs_seed(session, now):
                return False
        count = _rebuild(connection, data_path, now)
    logger.info("Seeded %d vehicles from %s", count, data_path)
    return True


def reset(engine: Engine, data_path: Path, now: datetime) -> None:
    with write_engine(engine).begin() as connection:
        count = _rebuild(connection, data_path, now)
    logger.info("Seeded %d vehicles from %s", count, data_path)


def reset_running_server(url: str) -> bool:
    """Ask a running dev server to reseed itself. Returns False if no server is listening."""
    request = urllib.request.Request(url, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30):
            return True
    except urllib.error.HTTPError as error:
        if error.code == 404:
            raise SystemExit(
                "A server is running without dev reset enabled. Stop it first, or start it "
                "with `npm run dev`."
            ) from None
        raise
    except (urllib.error.URLError, ConnectionError):
        return False


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="drop all data and reseed")
    parser.add_argument(
        "--live",
        action="store_true",
        help="with --reset: if the dev server is running, have it reseed itself so open tabs "
        "resync (otherwise reset the database file directly)",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    if args.reset and args.live:
        port = os.environ.get("API_PORT", "8000")
        if reset_running_server(f"http://127.0.0.1:{port}/api/dev/reset"):
            logger.info("The running server reseeded its data; open tabs resync automatically.")
            return

    settings = Settings.from_env()
    engine = create_db_engine(settings.database_url)
    now = SystemClock().now()
    if args.reset:
        reset(engine, settings.data_path, now)
    else:
        ensure_seeded(engine, settings.data_path, now)


if __name__ == "__main__":
    main()
