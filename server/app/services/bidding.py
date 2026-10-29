"""Placing bids and buying now.

Both run inside a write session (BEGIN IMMEDIATE). `_lock()` takes SQLite's write lock before
anything is read, and only then is the clock read — so a request that queued behind other bidders
is judged (live or ended? soft close?) and timestamped at the moment it actually executes.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.clock import Clock
from app.domain.auction import (
    AuctionStatus,
    BidRejection,
    ReserveStatus,
    auction_status,
    buy_now_available,
    extended_close,
    min_next_bid,
    reserve_status,
    validate_bid,
)
from app.errors import ApiError
from app.models import Bid, Vehicle
from app.services.inventory import bidder_labels, get_vehicle_or_404

BidKind = Literal["bid", "buy_now"]


@dataclass(frozen=True)
class BidResult:
    bid: Bid
    vehicle: Vehicle
    now: datetime  # when the bid was judged, under the lock
    # Who led before this bid — the live-updates stream tells them they were outbid. None on
    # replays, which publish nothing.
    previous_high_bidder: str | None
    # Everyone who has bid on this vehicle → their per-lot label ("Bidder 3"). The keys let live
    # events say "you have bid" exactly; the values label bids for other buyers.
    labels: dict[str, str]
    extended: bool
    replayed: bool  # an idempotent retry of an earlier request; nothing new was written


class BidRejectedError(Exception):
    def __init__(self, rejection: BidRejection, vehicle: Vehicle, now: datetime) -> None:
        super().__init__(rejection.value)
        self.rejection = rejection
        self.vehicle = vehicle
        self.now = now


class BuyNowUnavailableError(Exception):
    def __init__(self, vehicle: Vehicle, now: datetime) -> None:
        super().__init__("buy_now_unavailable")
        self.vehicle = vehicle
        self.now = now


def _lock(session: Session) -> None:
    """Start the transaction now: BEGIN IMMEDIATE blocks until we hold SQLite's write lock."""
    session.connection()


def _replay(
    session: Session,
    *,
    bidder_id: str,
    key: str | None,
    vehicle: Vehicle,
    kind: BidKind,
    amount: int | None,
    now: datetime,
) -> BidResult | None:
    """Return the earlier result for a retried request, if this idempotency key was used.

    The retry must be the *same* request — same vehicle, same kind, same amount — otherwise a key
    first used for a $12,000 bid could "replay" as a successful Buy Now.
    """
    if key is None:
        return None
    existing = session.scalar(
        select(Bid).where(Bid.bidder_id == bidder_id, Bid.idempotency_key == key)
    )
    if existing is None:
        return None
    same_request = (
        existing.vehicle_id == vehicle.id
        and existing.kind == kind
        and (amount is None or existing.amount == amount)
    )
    if not same_request:
        raise ApiError(
            409, "idempotency_key_reused", "This Idempotency-Key was already used for another bid."
        )
    return BidResult(
        bid=existing,
        vehicle=vehicle,
        now=now,
        previous_high_bidder=None,
        labels=bidder_labels(session, vehicle.id),
        extended=False,
        replayed=True,
    )


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
    clock: Clock,
    idempotency_key: str | None = None,
) -> BidResult:
    _lock(session)
    now = clock.now()
    vehicle = get_vehicle_or_404(session, vehicle_id)
    replay = _replay(
        session,
        bidder_id=bidder_id,
        key=idempotency_key,
        vehicle=vehicle,
        kind="bid",
        amount=amount,
        now=now,
    )
    if replay is not None:
        return replay

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
        reserve_met=reserve_status(
            vehicle.reserve_price, vehicle.current_bid, vehicle.buy_now_price
        )
        is not ReserveStatus.NOT_MET,
    )
    if rejection is not None:
        raise BidRejectedError(rejection, vehicle, now)

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

    labels = bidder_labels(session, vehicle.id)
    session.commit()
    return BidResult(bid, vehicle, now, previous, labels, extended=extended, replayed=False)


def buy_now(
    session: Session,
    *,
    vehicle_id: str,
    bidder_id: str,
    clock: Clock,
    idempotency_key: str | None = None,
) -> BidResult:
    _lock(session)
    now = clock.now()
    vehicle = get_vehicle_or_404(session, vehicle_id)
    replay = _replay(
        session,
        bidder_id=bidder_id,
        key=idempotency_key,
        vehicle=vehicle,
        kind="buy_now",
        amount=None,
        now=now,
    )
    if replay is not None:
        return replay

    status = auction_status(vehicle.starts_at, vehicle.ends_at, now)
    if vehicle.buy_now_price is None or not buy_now_available(
        status, vehicle.buy_now_price, vehicle.current_bid
    ):
        raise BuyNowUnavailableError(vehicle, now)

    bid = Bid(
        vehicle_id=vehicle.id,
        bidder_id=bidder_id,
        amount=vehicle.buy_now_price,
        kind="buy_now",
        placed_at=now,
        idempotency_key=idempotency_key,
    )
    previous = _record(session, vehicle, bid)
    # Close the auction now. An upcoming auction also "starts" now, otherwise its status would
    # still read upcoming (now < starts_at) after the sale.
    vehicle.starts_at = min(vehicle.starts_at, now)
    vehicle.ends_at = now

    labels = bidder_labels(session, vehicle.id)
    session.commit()
    return BidResult(bid, vehicle, now, previous, labels, extended=False, replayed=False)
