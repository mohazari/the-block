import asyncio
import random
from collections.abc import Callable
from datetime import timedelta
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from app import simulator as simulator_module
from app.clock import FrozenClock
from app.db import write_engine
from app.domain.auction import min_next_bid
from app.domain.bidders import RIVAL_BIDDER_IDS
from app.events import BidEvent, EventBroker
from app.models import Vehicle
from app.routers.events import events as events_endpoint
from app.services.bidding import BidResult, place_bid
from app.simulator import HUMAN_LEAD_GRACE, RivalSimulator

ME = "browser-me-0001"
OTHER = "browser-other-02"


def _write_sessions(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(write_engine(engine), expire_on_commit=False)


def _first_live(session: Session, clock: FrozenClock) -> Vehicle:
    vehicle = session.scalars(
        select(Vehicle)
        .where(Vehicle.starts_at <= clock.now(), Vehicle.ends_at > clock.now())
        .where(Vehicle.buy_now_price.is_(None))
        .order_by(Vehicle.ends_at)
    ).first()
    assert vehicle is not None
    return vehicle


def _bid(engine: Engine, clock: FrozenClock, vehicle_id: str, bidder: str) -> BidResult:
    with _write_sessions(engine)() as session:
        vehicle = session.get(Vehicle, vehicle_id)
        assert vehicle is not None
        amount = min_next_bid(vehicle.starting_bid, vehicle.current_bid)
        return place_bid(
            session, vehicle_id=vehicle_id, bidder_id=bidder, amount=amount, clock=clock
        )


# --- broker ----------------------------------------------------------------------------------


def test_events_are_personalized_per_subscriber(seeded_engine: Engine, clock: FrozenClock) -> None:
    with Session(seeded_engine) as session:
        vehicle_id = _first_live(session, clock).id
    _bid(seeded_engine, clock, vehicle_id, ME)
    outbid = _bid(seeded_engine, clock, vehicle_id, OTHER)

    async def scenario() -> dict[str | None, Any]:
        broker = EventBroker()
        broker.bind(asyncio.get_running_loop())
        received: dict[str | None, Any] = {}
        async with (
            broker.subscribe(ME) as me,
            broker.subscribe(OTHER) as other,
            broker.subscribe(None) as anonymous,
        ):
            await asyncio.to_thread(broker.publish, outbid)  # published from a worker thread
            for subscriber in (me, other, anonymous):
                event = await asyncio.wait_for(subscriber.queue.get(), timeout=1)
                assert event is not None
                received[subscriber.bidder_id] = event.for_subscriber(subscriber.bidder_id)
        assert broker.subscriber_count == 0
        return received

    received = asyncio.run(scenario())
    assert received[ME].outbid_you and not received[ME].auction.is_high_bidder
    assert received[ME].auction.has_bid
    assert received[OTHER].bid.is_you and received[OTHER].auction.is_high_bidder
    assert not received[OTHER].outbid_you
    assert not any((received[None].outbid_you, received[None].bid.is_you))
    assert received[None].auction.current_bid == outbid.bid.amount
    assert received[ME].vehicle_title == outbid.vehicle.title


def test_replayed_requests_are_not_republished(seeded_engine: Engine, clock: FrozenClock) -> None:
    with Session(seeded_engine) as session:
        vehicle_id = _first_live(session, clock).id
    result = _bid(seeded_engine, clock, vehicle_id, ME)

    async def scenario() -> bool:
        broker = EventBroker()
        broker.bind(asyncio.get_running_loop())
        async with broker.subscribe(ME) as subscriber:
            broker.publish(BidResult(**{**result.__dict__, "replayed": True}))
            await asyncio.sleep(0.05)
            return subscriber.queue.empty()

    assert asyncio.run(scenario())


def test_slow_subscribers_are_cut_off(
    seeded_engine: Engine, clock: FrozenClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    with Session(seeded_engine) as session:
        vehicle_id = _first_live(session, clock).id
    result = _bid(seeded_engine, clock, vehicle_id, ME)
    monkeypatch.setattr("app.events._QUEUE_SIZE", 2)

    async def scenario() -> list[Any]:
        broker = EventBroker()
        broker.bind(asyncio.get_running_loop())
        async with broker.subscribe(ME) as subscriber:
            for _ in range(3):
                broker.publish(result)
            await asyncio.sleep(0.05)
            assert broker.subscriber_count == 0
            return [subscriber.queue.get_nowait() for _ in range(subscriber.queue.qsize())]

    drained = asyncio.run(scenario())
    assert drained[-1] is None  # the stream is told to end so the client reconnects


# --- SSE endpoint ----------------------------------------------------------------------------


def test_stream_says_hello_then_relays_personalized_bids(
    seeded_engine: Engine, clock: FrozenClock
) -> None:
    with Session(seeded_engine) as session:
        vehicle_id = _first_live(session, clock).id
    _bid(seeded_engine, clock, vehicle_id, ME)
    outbid = _bid(seeded_engine, clock, vehicle_id, OTHER)

    async def scenario() -> list[Any]:
        broker = EventBroker()
        broker.bind(asyncio.get_running_loop())
        request = SimpleNamespace(
            app=SimpleNamespace(
                state=SimpleNamespace(
                    broker=broker,
                    clock=clock,
                    data_epoch="epoch-1",
                    run_id="run-1",
                )
            )
        )
        stream = events_endpoint(request, bidder_id=ME)  # type: ignore[arg-type]
        hello = await anext(stream)
        broker.publish(outbid)
        bid = await asyncio.wait_for(anext(stream), timeout=1)
        await stream.aclose()
        assert broker.subscriber_count == 0  # unsubscribed when the client goes away
        return [hello, bid]

    hello, bid = asyncio.run(scenario())
    assert hello.event == "hello" and hello.retry == 2000
    assert hello.data["epoch"] == "epoch-1" and hello.data["run"] == "run-1"
    assert bid.event == "bid" and bid.id is None  # events aren't replayable; no ids
    assert bid.data.outbid_you and bid.data.vehicle_id == vehicle_id


def test_stream_rejects_invalid_bidder_ids(client: TestClient) -> None:
    response = client.get("/api/events", params={"bidder_id": "rival-01"})
    assert response.status_code == 400
    assert response.json()["error"]["message"].startswith("bidder_id:")


def test_has_bid_is_exact_for_earlier_bidders(seeded_engine: Engine, clock: FrozenClock) -> None:
    """A bidder who was outbid two bids ago still 'has bid' when a third bidder comes in."""
    with Session(seeded_engine) as session:
        vehicle_id = _first_live(session, clock).id
    _bid(seeded_engine, clock, vehicle_id, ME)
    _bid(seeded_engine, clock, vehicle_id, OTHER)
    third = _bid(seeded_engine, clock, vehicle_id, "browser-third-03")

    event = BidEvent.from_result(third)
    assert event.for_subscriber(ME).auction.has_bid
    assert not event.for_subscriber(ME).outbid_you
    assert event.for_subscriber(OTHER).outbid_you
    assert not event.for_subscriber("browser-never-04").auction.has_bid


# --- simulator -------------------------------------------------------------------------------


def _simulator(
    engine: Engine, clock: FrozenClock, seed: int = 7
) -> tuple[RivalSimulator, list[BidResult]]:
    published: list[BidResult] = []
    simulator = RivalSimulator(
        sessionmaker(engine, expire_on_commit=False),
        _write_sessions(engine),
        clock,
        published.append,
        random.Random(seed),
    )
    return simulator, published


def _fixed_ceiling(monkeypatch: pytest.MonkeyPatch, ceiling: Callable[[Vehicle], int]) -> None:
    monkeypatch.setattr(RivalSimulator, "ceiling", lambda _self, vehicle: ceiling(vehicle))


def test_rivals_counter_a_human_leader_only_after_the_grace_period(
    seeded_engine: Engine, clock: FrozenClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(simulator_module, "COUNTER_HUMAN_CHANCE", 1.0)
    _fixed_ceiling(monkeypatch, lambda _vehicle: 10_000_000)  # isolate the grace rule
    with Session(seeded_engine) as session:
        vehicle_id = _first_live(session, clock).id
    _bid(seeded_engine, clock, vehicle_id, ME)
    simulator, published = _simulator(seeded_engine, clock)

    first = simulator.tick()
    assert first is None or first.vehicle.id != vehicle_id  # too soon to counter

    clock.advance(HUMAN_LEAD_GRACE + timedelta(seconds=1))
    countered = simulator.tick()
    assert countered is not None
    assert countered.vehicle.id == vehicle_id
    assert countered.bid.bidder_id in RIVAL_BIDDER_IDS
    assert countered.previous_high_bidder == ME
    assert published[-1] is countered


def test_rivals_leave_pre_bids_alone(
    seeded_engine: Engine, clock: FrozenClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(simulator_module, "COUNTER_HUMAN_CHANCE", 1.0)
    _fixed_ceiling(monkeypatch, lambda _vehicle: 10_000_000)
    with Session(seeded_engine) as session:
        upcoming = session.scalars(
            select(Vehicle)
            .where(Vehicle.starts_at > clock.now(), Vehicle.buy_now_price.is_(None))
            .order_by(Vehicle.starts_at)
        ).first()
        assert upcoming is not None
    _bid(seeded_engine, clock, upcoming.id, ME)
    clock.advance(HUMAN_LEAD_GRACE + timedelta(seconds=1))
    simulator, published = _simulator(seeded_engine, clock)
    for _ in range(20):
        simulator.tick()
    assert all(result.vehicle.id != upcoming.id for result in published)


def test_rivals_stop_at_their_ceiling(
    seeded_engine: Engine, clock: FrozenClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fixed_ceiling(
        monkeypatch, lambda vehicle: min_next_bid(vehicle.starting_bid, vehicle.current_bid) - 1
    )
    simulator, _ = _simulator(seeded_engine, clock)
    assert simulator.tick() is None


def test_ceilings_are_stable_for_a_run(seeded_engine: Engine, clock: FrozenClock) -> None:
    simulator, _ = _simulator(seeded_engine, clock)
    with Session(seeded_engine) as session:
        vehicle = _first_live(session, clock)
        assert simulator.ceiling(vehicle) == simulator.ceiling(vehicle)


def test_rivals_never_bid_on_ended_auctions(seeded_engine: Engine, clock: FrozenClock) -> None:
    clock.advance(timedelta(days=30))
    simulator, published = _simulator(seeded_engine, clock)
    assert simulator.tick() is None
    assert published == []


def test_rival_bids_follow_every_auction_rule(seeded_engine: Engine, clock: FrozenClock) -> None:
    simulator, published = _simulator(seeded_engine, clock, seed=11)
    for _ in range(40):
        simulator.tick()
    assert published, "rivals should have found something to bid on"
    for result in published:
        assert result.vehicle.starts_at <= result.now  # live auctions only
        assert result.bid.amount <= simulator.ceiling(result.vehicle)
        buy_now = result.vehicle.buy_now_price
        assert buy_now is None or result.bid.amount < buy_now


def test_publish_failures_never_fail_the_bid(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def explode(_result: object) -> None:
        raise ValueError("boom")

    monkeypatch.setattr("app.events.BidEvent.from_result", explode)
    vehicle = client.get("/api/vehicles", params={"page_size": 1}).json()["items"][0]
    response = client.post(
        f"/api/vehicles/{vehicle['id']}/bids",
        json={"amount": vehicle["auction"]["min_next_bid"]},
        headers={"X-Bidder-Id": ME},
    )
    assert response.status_code == 201


def test_a_quiet_stream_sends_heartbeats(
    clock: FrozenClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """So a client can tell "no bids lately" from a connection that silently died."""
    monkeypatch.setattr("app.routers.events.HEARTBEAT_SECONDS", 0.05)

    async def scenario() -> Any:
        broker = EventBroker()
        broker.bind(asyncio.get_running_loop())
        state = SimpleNamespace(broker=broker, clock=clock, data_epoch="e", run_id="r")
        stream = events_endpoint(SimpleNamespace(app=SimpleNamespace(state=state)), bidder_id=ME)  # type: ignore[arg-type]
        await anext(stream)  # hello
        ping = await asyncio.wait_for(anext(stream), timeout=1)
        await stream.aclose()
        return ping

    assert asyncio.run(scenario()).event == "ping"
