import json
import threading
from datetime import UTC, datetime, timedelta
from itertools import pairwise

from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select, text
from sqlalchemy.orm import Session

from app.clock import FrozenClock
from app.db import write_engine
from app.domain.auction import AuctionStatus, auction_status, min_next_bid
from app.domain.bidders import RIVAL_BIDDER_IDS
from app.domain.schedule import FIRST_CLOSE_LEAD
from app.models import Base, Bid, Meta, Vehicle
from app.seed import data_epoch, ensure_seeded, needs_seed, reset
from app.services.inventory import _ranges

from .conftest import DATA_PATH

DATASET = json.loads(DATA_PATH.read_text())


def test_seed_loads_every_vehicle(seeded_engine: Engine) -> None:
    with Session(seeded_engine) as session:
        assert session.scalar(select(func.count()).select_from(Vehicle)) == len(DATASET) == 200


def test_seeded_schedule_has_live_and_upcoming_auctions(
    seeded_engine: Engine, clock: FrozenClock
) -> None:
    now = clock.now()
    with Session(seeded_engine) as session:
        vehicles = session.scalars(select(Vehicle)).all()
        statuses = [auction_status(v.starts_at, v.ends_at, now) for v in vehicles]
        first_close = min(v.ends_at for v in vehicles)

    assert statuses.count(AuctionStatus.LIVE) == 112
    assert statuses.count(AuctionStatus.UPCOMING) == 88
    assert abs(first_close - (now + FIRST_CLOSE_LEAD)) < timedelta(minutes=1)


def test_seeded_history_obeys_the_increment_ladder(seeded_engine: Engine) -> None:
    by_id = {record["id"]: record for record in DATASET}
    truncated = 0
    with Session(seeded_engine) as session:
        for vehicle in session.scalars(select(Vehicle)):
            record = by_id[vehicle.id]
            amounts = [bid.amount for bid in reversed(vehicle.bids)]  # oldest first
            assert vehicle.bid_count == len(amounts) <= record["bid_count"]
            truncated += len(amounts) < record["bid_count"]
            if amounts:
                assert amounts[-1] == record["current_bid"]
                assert amounts[0] >= record["starting_bid"]
                for earlier, later in pairwise(amounts):
                    assert later >= min_next_bid(record["starting_bid"], earlier)
                assert vehicle.high_bidder_id == vehicle.bids[0].bidder_id
                bidders = [bid.bidder_id for bid in vehicle.bids]
                assert all(a != b for a, b in pairwise(bidders))
                assert set(bidders) <= set(RIVAL_BIDDER_IDS)
    # The dataset claims more bids than fit the ladder for these; see ladder_amounts().
    assert truncated == 34


def test_reserve_price_survives_seeding(seeded_engine: Engine) -> None:
    with Session(seeded_engine) as session:
        with_reserve = session.scalar(
            select(func.count()).select_from(Vehicle).where(Vehicle.reserve_price.is_not(None))
        )
    assert with_reserve == sum(1 for r in DATASET if r["reserve_price"] is not None)


def test_reseeds_once_every_auction_has_closed(seeded_engine: Engine, clock: FrozenClock) -> None:
    with Session(seeded_engine) as session:
        assert not needs_seed(session, clock.now())

    clock.advance(timedelta(days=30))
    with Session(seeded_engine) as session:
        assert needs_seed(session, clock.now())

    ensure_seeded(seeded_engine, DATA_PATH, clock.now())
    with Session(seeded_engine) as session:
        assert not needs_seed(session, clock.now())


def test_write_sessions_serialize_read_then_write(seeded_engine: Engine) -> None:
    """Two writers that read-then-update must not interleave: the second sees the first's write.

    This is the property the bid transaction relies on (BEGIN IMMEDIATE takes the write lock
    before the read).
    """
    with Session(seeded_engine) as session:
        vehicle_id = session.scalars(select(Vehicle.id).limit(1)).one()

    barrier = threading.Barrier(2)
    seen: list[int] = []

    def increment() -> None:
        barrier.wait()
        with Session(write_engine(seeded_engine)) as session, session.begin():
            count = session.scalar(
                text("SELECT bid_count FROM vehicles WHERE id = :id"), {"id": vehicle_id}
            )
            assert count is not None
            seen.append(count)
            session.execute(
                text("UPDATE vehicles SET bid_count = :c WHERE id = :id"),
                {"c": count + 1, "id": vehicle_id},
            )

    threads = [threading.Thread(target=increment) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(seen) == 2
    assert seen[0] != seen[1], "both writers read the same value — lost update"
    with Session(seeded_engine) as session:
        final = session.scalar(
            text("SELECT bid_count FROM vehicles WHERE id = :id"), {"id": vehicle_id}
        )
    assert final == max(seen) + 1


def test_bid_count_matches_stored_bids(seeded_engine: Engine) -> None:
    with Session(seeded_engine) as session:
        total_bids = session.scalar(select(func.count()).select_from(Bid))
        total_count = session.scalar(select(func.sum(Vehicle.bid_count)))
    assert total_bids == total_count


def test_ensure_seeded_is_a_no_op_on_a_current_database(
    seeded_engine: Engine, clock: FrozenClock
) -> None:
    assert ensure_seeded(seeded_engine, DATA_PATH, clock.now()) is False


def test_reseeds_when_schema_version_changes(seeded_engine: Engine, clock: FrozenClock) -> None:
    with Session(seeded_engine) as session, session.begin():
        meta = session.get(Meta, "schema_version")
        assert meta is not None
        meta.value = "0"
    assert ensure_seeded(seeded_engine, DATA_PATH, clock.now()) is True
    with Session(seeded_engine) as session:
        assert not needs_seed(session, clock.now())


def test_ranges_tolerate_an_empty_inventory(engine: Engine) -> None:
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        ranges = _ranges(session)
    assert ranges.price.min == ranges.price.max == 0


def test_data_epoch_changes_when_the_data_is_reseeded(
    seeded_engine: Engine, clock: FrozenClock
) -> None:
    first = data_epoch(seeded_engine)
    clock.advance(timedelta(days=30))
    ensure_seeded(seeded_engine, DATA_PATH, clock.now())
    assert first and data_epoch(seeded_engine) != first


def test_every_api_response_carries_the_current_data_epoch(client: TestClient) -> None:
    first = client.get("/api/health").headers["X-Data-Epoch"]
    engine = client.app.state.engine  # type: ignore[attr-defined]
    reset(engine, DATA_PATH, datetime(2026, 11, 1, tzinfo=UTC))  # e.g. npm run reset-db
    second = client.get("/api/vehicles", params={"page_size": 1}).headers["X-Data-Epoch"]
    assert first and second != first
