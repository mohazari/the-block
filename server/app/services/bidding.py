"""Placing bids and buying now.

Both run inside a write session (BEGIN IMMEDIATE): the very first statement takes SQLite's write
lock, so reading the current price, validating against it and writing the new bid happen as one
step no other bidder can interleave with.
"""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.auction import (
    AuctionStatus,
    BidRejection,
    auction_status,
    buy_now_available,
    extended_close,
    min_next_bid,
    validate_bid,
)
from app.errors import ApiError
from app.models import Bid, Vehicle


@dataclass(frozen=True)
class BidResult:
    bid: Bid
    vehicle: Vehicle
    previous_high_bidder: str | None
    extended: bool
    replayed: bool  # an idempotent retry of an earlier request; nothing new was written


class BidRejectedError(Exception):
    def __init__(self, rejection: BidRejection, vehicle: Vehicle) -> None:
        super().__init__(rejection.value)
        self.rejection = rejection
        self.vehicle = vehicle


class BuyNowUnavailableError(Exception):
    def __init__(self, vehicle: Vehicle) -> None:
        super().__init__("buy_now_unavailable")
        self.vehicle = vehicle


def _replay(
    session: Session, bidder_id: str, key: str | None, vehicle_id: str, amount: int | None
) -> BidResult | None:
    """Return the earlier result for a retried request, if this idempotency key was used."""
    if key is None:
        return None
    existing = session.scalar(
        select(Bid).where(Bid.bidder_id == bidder_id, Bid.idempotency_key == key)
    )
    if existing is None:
        return None
    if existing.vehicle_id != vehicle_id or (amount is not None and existing.amount != amount):
        raise ApiError(
            409, "idempotency_key_reused", "This Idempotency-Key was already used for another bid."
        )
    return BidResult(
        bid=existing,
        vehicle=existing.vehicle,
        previous_high_bidder=None,
        extended=False,
        replayed=True,
    )


def _locked_vehicle(session: Session, vehicle_id: str) -> Vehicle:
    vehicle = session.get(Vehicle, vehicle_id)
    if vehicle is None:
        raise ApiError(404, "vehicle_not_found", "No vehicle with that id.")
    return vehicle


def _record(session: Session, vehicle: Vehicle, bid: Bid) -> str | None:
    previous = vehicle.high_bidder_id
    session.add(bid)
    vehicle.current_bid = bid.amount
    vehicle.bid_count += 1
    vehicle.high_bidder_id = bid.bidder_id
    return previous


def place_bid(
    session: Session,
    *,
    vehicle_id: str,
    bidder_id: str,
    amount: int,
    now: datetime,
    idempotency_key: str | None = None,
) -> BidResult:
    replay = _replay(session, bidder_id, idempotency_key, vehicle_id, amount)
    if replay is not None:
        return replay

    vehicle = _locked_vehicle(session, vehicle_id)
    status = auction_status(vehicle.starts_at, vehicle.ends_at, now)
    rejection = validate_bid(
        amount=amount,
        status=status,
        minimum=min_next_bid(vehicle.starting_bid, vehicle.current_bid),
        bidder_id=bidder_id,
        high_bidder_id=vehicle.high_bidder_id,
        available_buy_now=(
            vehicle.buy_now_price
            if buy_now_available(status, vehicle.buy_now_price, vehicle.current_bid)
            else None
        ),
    )
    if rejection is not None:
        raise BidRejectedError(rejection, vehicle)

    bid = Bid(
        vehicle_id=vehicle.id,
        bidder_id=bidder_id,
        amount=amount,
        placed_at=now,
        idempotency_key=idempotency_key,
    )
    previous = _record(session, vehicle, bid)

    # Pre-bids on upcoming auctions never move the close; only live bids can trigger soft close.
    new_end = extended_close(vehicle.ends_at, now) if status is AuctionStatus.LIVE else None
    extended = new_end is not None and new_end != vehicle.ends_at
    if new_end is not None:
        vehicle.ends_at = new_end

    session.commit()
    return BidResult(bid, vehicle, previous, extended=extended, replayed=False)


def buy_now(
    session: Session,
    *,
    vehicle_id: str,
    bidder_id: str,
    now: datetime,
    idempotency_key: str | None = None,
) -> BidResult:
    replay = _replay(session, bidder_id, idempotency_key, vehicle_id, amount=None)
    if replay is not None:
        return replay

    vehicle = _locked_vehicle(session, vehicle_id)
    status = auction_status(vehicle.starts_at, vehicle.ends_at, now)
    if vehicle.buy_now_price is None or not buy_now_available(
        status, vehicle.buy_now_price, vehicle.current_bid
    ):
        raise BuyNowUnavailableError(vehicle)

    bid = Bid(
        vehicle_id=vehicle.id,
        bidder_id=bidder_id,
        amount=vehicle.buy_now_price,
        placed_at=now,
        idempotency_key=idempotency_key,
    )
    previous = _record(session, vehicle, bid)
    # Close the auction now. An upcoming auction also "starts" now, otherwise its status would
    # still read upcoming (now < starts_at) after the sale.
    vehicle.starts_at = min(vehicle.starts_at, now)
    vehicle.ends_at = now

    session.commit()
    return BidResult(bid, vehicle, previous, extended=False, replayed=False)
