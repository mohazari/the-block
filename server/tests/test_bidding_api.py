import sqlite3
import threading
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.clock import FrozenClock
from app.db import write_engine
from app.domain.auction import BidRejection
from app.services.bidding import BidRejectedError, place_bid

ME = {"X-Bidder-Id": "browser-me-0001"}
RIVAL = {"X-Bidder-Id": "browser-rival-0002"}


def _vehicles(client: TestClient, **params: Any) -> list[dict[str, Any]]:
    params = {"page_size": 100, **params}
    items: list[dict[str, Any]] = client.get("/api/vehicles", params=params).json()["items"]
    return items


def _find(client: TestClient, predicate: Callable[[dict[str, Any]], bool], **params: Any) -> Any:
    for page in (1, 2):
        for item in _vehicles(client, page=page, **params):
            if predicate(item):
                return item
    raise AssertionError("no vehicle matches")


def _bid(client: TestClient, vehicle_id: str, amount: int, headers: dict[str, str] = ME) -> Any:
    return client.post(f"/api/vehicles/{vehicle_id}/bids", json={"amount": amount}, headers=headers)


def _live_without_buy_now(client: TestClient) -> Any:
    return _find(
        client,
        lambda v: v["auction"]["status"] == "live" and not v["auction"]["buy_now_available"],
    )


def test_placing_the_minimum_bid_makes_you_the_high_bidder(client: TestClient) -> None:
    vehicle = _live_without_buy_now(client)
    before = vehicle["auction"]

    response = _bid(client, vehicle["id"], before["min_next_bid"])
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["bid"]["is_you"] and body["bid"]["amount"] == before["min_next_bid"]
    assert body["auction"]["current_bid"] == before["min_next_bid"]
    assert body["auction"]["bid_count"] == before["bid_count"] + 1
    assert body["auction"]["is_high_bidder"] and body["auction"]["has_bid"]

    detail = client.get(f"/api/vehicles/{vehicle['id']}", headers=ME).json()
    assert detail["recent_bids"][0]["is_you"]
    assert detail["auction"]["is_high_bidder"]
    # Someone else sees the same price but is not leading.
    other = client.get(f"/api/vehicles/{vehicle['id']}", headers=RIVAL).json()
    assert other["auction"]["current_bid"] == before["min_next_bid"]
    assert not other["auction"]["is_high_bidder"]


def test_bidding_requires_a_bidder_id(client: TestClient) -> None:
    vehicle = _live_without_buy_now(client)
    response = _bid(client, vehicle["id"], vehicle["auction"]["min_next_bid"], headers={})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "bidder_id_required"


@pytest.mark.parametrize(
    ("amount_of", "code"),
    [
        (lambda a: a["min_next_bid"] - 1, "bid_too_low"),
        (lambda a: a["max_bid"] + 1, "bid_too_high"),
    ],
)
def test_rejections_carry_a_fresh_snapshot(
    client: TestClient, amount_of: Callable[[dict[str, Any]], int], code: str
) -> None:
    vehicle = _live_without_buy_now(client)
    response = _bid(client, vehicle["id"], amount_of(vehicle["auction"]))
    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == code
    assert error["auction"]["min_next_bid"] == vehicle["auction"]["min_next_bid"]
    assert error["message"]


def test_too_high_message_follows_the_configured_multiplier(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.routers.bids.MAX_JUMP_MULTIPLIER", 5)
    vehicle = _live_without_buy_now(client)
    response = _bid(client, vehicle["id"], vehicle["auction"]["max_bid"] + 1)
    assert "more than 5x the minimum" in response.json()["error"]["message"]


def test_you_cannot_outbid_yourself_once_the_reserve_is_met(client: TestClient) -> None:
    vehicle = _find(
        client,
        lambda v: (
            v["auction"]["status"] == "live"
            and not v["auction"]["buy_now_available"]
            and v["auction"]["reserve_status"] == "no_reserve"
        ),
    )
    first = _bid(client, vehicle["id"], vehicle["auction"]["min_next_bid"]).json()
    again = _bid(client, vehicle["id"], first["auction"]["min_next_bid"])
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "already_high_bidder"
    assert again.json()["error"]["auction"]["has_bid"]


def test_outbid_by_a_rival_then_back_in_front(client: TestClient) -> None:
    vehicle = _live_without_buy_now(client)
    mine = _bid(client, vehicle["id"], vehicle["auction"]["min_next_bid"]).json()
    theirs = _bid(client, vehicle["id"], mine["auction"]["min_next_bid"], headers=RIVAL).json()

    stale = _bid(client, vehicle["id"], mine["auction"]["min_next_bid"])
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "bid_too_low"
    retry = _bid(client, vehicle["id"], theirs["auction"]["min_next_bid"])
    assert retry.status_code == 201 and retry.json()["auction"]["is_high_bidder"]


def test_bids_on_ended_auctions_are_refused(client: TestClient, clock: FrozenClock) -> None:
    first_to_close = _vehicles(client, page_size=1)[0]
    clock.advance(timedelta(hours=1))
    response = _bid(client, first_to_close["id"], first_to_close["auction"]["min_next_bid"])
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "auction_ended"


def test_pre_bids_on_upcoming_auctions_do_not_move_the_close(client: TestClient) -> None:
    upcoming = _find(client, lambda v: not v["auction"]["buy_now_available"], status="upcoming")
    response = _bid(client, upcoming["id"], upcoming["auction"]["min_next_bid"])
    assert response.status_code == 201
    body = response.json()
    assert body["auction"]["status"] == "upcoming"
    assert body["auction"]["ends_at"] == upcoming["auction"]["ends_at"]
    assert not body["extended"]


def test_late_bid_triggers_soft_close(client: TestClient, clock: FrozenClock) -> None:
    first_to_close = _vehicles(client, page_size=1)[0]
    ends_at = datetime.fromisoformat(first_to_close["auction"]["ends_at"])
    clock.advance(ends_at - clock.now() - timedelta(seconds=30))

    response = _bid(client, first_to_close["id"], first_to_close["auction"]["min_next_bid"])
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["extended"]
    assert datetime.fromisoformat(body["auction"]["ends_at"]) == clock.now() + timedelta(minutes=2)


def test_bid_at_buy_now_price_is_redirected(client: TestClient) -> None:
    vehicle = _find(client, lambda v: v["auction"]["buy_now_available"])
    price = vehicle["auction"]["buy_now_price"]
    response = _bid(client, vehicle["id"], price)
    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "use_buy_now"
    assert f"${price:,}" in error["message"]


@pytest.mark.parametrize("status", ["live", "upcoming"])
def test_buy_now_closes_the_auction_as_sold(client: TestClient, status: str) -> None:
    vehicle = _find(client, lambda v: v["auction"]["buy_now_available"], status=status)
    url = f"/api/vehicles/{vehicle['id']}/buy-now"

    response = client.post(url, headers=ME)
    assert response.status_code == 201, response.text
    auction = response.json()["auction"]
    assert auction["status"] == "ended"
    assert auction["outcome"] == "sold"
    assert auction["is_high_bidder"]
    assert auction["current_bid"] == vehicle["auction"]["buy_now_price"]

    assert client.post(url, headers=RIVAL).json()["error"]["code"] == "buy_now_unavailable"
    late = _bid(client, vehicle["id"], auction["min_next_bid"], headers=RIVAL)
    assert late.json()["error"]["code"] == "auction_ended"


def test_retried_request_with_the_same_key_bids_once(client: TestClient) -> None:
    vehicle = _live_without_buy_now(client)
    amount = vehicle["auction"]["min_next_bid"]
    headers = {**ME, "Idempotency-Key": "retry-key-1"}
    url = f"/api/vehicles/{vehicle['id']}/bids"

    first = client.post(url, json={"amount": amount}, headers=headers)
    second = client.post(url, json={"amount": amount}, headers=headers)
    assert (first.status_code, second.status_code) == (201, 200)
    assert first.json()["bid"]["id"] == second.json()["bid"]["id"]
    assert second.json()["auction"]["bid_count"] == vehicle["auction"]["bid_count"] + 1

    reused = client.post(url, json={"amount": amount + 500}, headers=headers)
    assert reused.status_code == 409
    assert reused.json()["error"]["code"] == "idempotency_key_reused"


def test_concurrent_equal_bids_have_exactly_one_winner(
    client: TestClient, clock: FrozenClock
) -> None:
    """Many bidders submit the same minimum at the same instant: one wins, the rest are told the
    price moved. Runs against the service with real threads (TestClient would serialize)."""
    vehicle = _live_without_buy_now(client)
    amount = vehicle["auction"]["min_next_bid"]
    engine: Engine = client.app.state.write_sessions.kw["bind"]  # type: ignore[attr-defined]

    contenders = 6
    barrier = threading.Barrier(contenders)
    outcomes: list[str] = []
    lock = threading.Lock()

    def contend(n: int) -> None:
        barrier.wait()
        with Session(write_engine(engine)) as session:
            try:
                place_bid(
                    session,
                    vehicle_id=vehicle["id"],
                    bidder_id=f"contender-{n:04d}",
                    amount=amount,
                    clock=clock,
                )
                result = "won"
            except BidRejectedError as rejected:
                assert rejected.rejection is BidRejection.BID_TOO_LOW
                result = "too_low"
        with lock:
            outcomes.append(result)

    threads = [threading.Thread(target=contend, args=(n,)) for n in range(contenders)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(outcomes) == ["too_low"] * (contenders - 1) + ["won"]
    after = client.get(f"/api/vehicles/{vehicle['id']}").json()["auction"]
    assert after["bid_count"] == vehicle["auction"]["bid_count"] + 1


def test_my_bids_tracks_standing_through_the_auction(
    client: TestClient, clock: FrozenClock
) -> None:
    assert client.get("/api/me/bids", headers=ME).json() == []

    first_to_close = _vehicles(client, page_size=1)[0]
    mine = _bid(client, first_to_close["id"], first_to_close["auction"]["min_next_bid"]).json()
    [item] = client.get("/api/me/bids", headers=ME).json()
    assert item["standing"] == "leading" and item["my_top_bid"] == mine["bid"]["amount"]

    _bid(client, first_to_close["id"], mine["auction"]["min_next_bid"], headers=RIVAL)
    [item] = client.get("/api/me/bids", headers=ME).json()
    assert item["standing"] == "outbid"

    clock.advance(timedelta(hours=1))
    [item] = client.get("/api/me/bids", headers=ME).json()
    assert item["standing"] == "lost"
    [rival_item] = client.get("/api/me/bids", headers=RIVAL).json()
    expected = "won" if rival_item["auction"]["outcome"] == "sold" else "lost"
    assert rival_item["standing"] == expected


def test_watchlist_round_trip(client: TestClient) -> None:
    vehicle = _vehicles(client, page_size=1)[0]
    url = f"/api/me/watchlist/{vehicle['id']}"

    assert client.put(url, headers=ME).status_code == 204
    assert client.put(url, headers=ME).status_code == 204  # idempotent
    watched = client.get("/api/vehicles", params={"watching": True}, headers=ME).json()
    assert [v["id"] for v in watched["items"]] == [vehicle["id"]]
    assert client.get(f"/api/vehicles/{vehicle['id']}", headers=ME).json()["watching"]
    assert not client.get(f"/api/vehicles/{vehicle['id']}", headers=RIVAL).json()["watching"]

    assert client.delete(url, headers=ME).status_code == 204
    assert client.get("/api/vehicles", params={"watching": True}, headers=ME).json()["total"] == 0
    assert client.put("/api/me/watchlist/nope", headers=ME).status_code == 404


def test_idempotency_key_cannot_turn_a_bid_into_a_buy_now(client: TestClient) -> None:
    vehicle = _find(client, lambda v: v["auction"]["buy_now_available"])
    headers = {**ME, "Idempotency-Key": "shared-key"}
    bid = client.post(
        f"/api/vehicles/{vehicle['id']}/bids",
        json={"amount": vehicle["auction"]["min_next_bid"]},
        headers=headers,
    )
    assert bid.status_code == 201
    buy = client.post(f"/api/vehicles/{vehicle['id']}/buy-now", headers=headers)
    assert buy.status_code == 409
    assert buy.json()["error"]["code"] == "idempotency_key_reused"


def test_empty_idempotency_key_is_rejected(client: TestClient) -> None:
    vehicle = _live_without_buy_now(client)
    response = client.post(
        f"/api/vehicles/{vehicle['id']}/bids",
        json={"amount": vehicle["auction"]["min_next_bid"]},
        headers={**ME, "Idempotency-Key": ""},
    )
    assert response.status_code == 422


def test_unknown_vehicle_wins_over_a_reused_key(client: TestClient) -> None:
    vehicle = _live_without_buy_now(client)
    headers = {**ME, "Idempotency-Key": "key-404"}
    url = f"/api/vehicles/{vehicle['id']}/bids"
    client.post(url, json={"amount": vehicle["auction"]["min_next_bid"]}, headers=headers)
    response = client.post("/api/vehicles/nope/bids", json={"amount": 1000}, headers=headers)
    assert response.status_code == 404


def test_the_clock_is_read_while_holding_the_write_lock(
    client: TestClient, clock: FrozenClock
) -> None:
    """A bid queued behind other writers must be judged when it runs, not when it arrived."""
    vehicle = _live_without_buy_now(client)
    engine: Engine = client.app.state.write_sessions.kw["bind"]  # type: ignore[attr-defined]

    with Session(write_engine(engine)) as session:

        class LockCheckingClock:
            def now(self) -> datetime:
                assert session.in_transaction(), "clock read before the write lock was taken"
                return clock.now()

        place_bid(
            session,
            vehicle_id=vehicle["id"],
            bidder_id="browser-lock-0001",
            amount=vehicle["auction"]["min_next_bid"],
            clock=LockCheckingClock(),
        )


def test_lock_timeout_is_a_retryable_503(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def locked(*_args: object, **_kwargs: object) -> None:
        raise OperationalError(
            "BEGIN IMMEDIATE", {}, sqlite3.OperationalError("database is locked")
        )

    monkeypatch.setattr("app.routers.bids.place_bid", locked)
    vehicle = _live_without_buy_now(client)
    response = _bid(client, vehicle["id"], vehicle["auction"]["min_next_bid"])
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "1"
    assert response.json()["error"]["code"] == "busy"


def test_leader_can_raise_toward_an_unmet_reserve(client: TestClient) -> None:
    vehicle = _find(
        client,
        lambda v: (
            v["auction"]["status"] == "live"
            and not v["auction"]["buy_now_available"]
            and v["auction"]["reserve_status"] == "not_met"
        ),
    )
    first = _bid(client, vehicle["id"], vehicle["auction"]["min_next_bid"]).json()
    assert first["auction"]["reserve_status"] == "not_met"

    raise_ = _bid(client, vehicle["id"], first["auction"]["min_next_bid"])
    assert raise_.status_code == 201, raise_.text
    assert raise_.json()["auction"]["is_high_bidder"]


def test_watchlist_endpoint_lists_every_watched_vehicle(
    client: TestClient, clock: FrozenClock
) -> None:
    vehicles = _vehicles(client, page_size=3)
    for vehicle in vehicles:
        client.put(f"/api/me/watchlist/{vehicle['id']}", headers=ME)
    clock.advance(timedelta(hours=1))  # the first one has now ended: it still belongs here

    watched = client.get("/api/me/watchlist", headers=ME).json()
    assert {item["id"] for item in watched} == {v["id"] for v in vehicles}
    assert all(item["watching"] for item in watched)
    assert watched[-1]["auction"]["status"] == "ended"  # open auctions first
    assert client.get("/api/me/watchlist", headers=RIVAL).json() == []
