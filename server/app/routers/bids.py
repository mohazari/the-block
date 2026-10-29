from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request, Response, status
from sqlalchemy.orm import Session

from app.clock import Clock
from app.deps import RequiredBidderId, WriteSession, get_clock
from app.domain.auction import MAX_JUMP_MULTIPLIER, BidRejection, max_allowed_bid
from app.errors import ApiError
from app.models import Bid, Vehicle
from app.schemas import AuctionSnapshot, BidPlaced, PlaceBidRequest
from app.services.bidding import (
    BidRejectedError,
    BidResult,
    BuyNowUnavailableError,
    buy_now,
    place_bid,
)
from app.services.inventory import bid_out, ids_for_bidder, snapshot

router = APIRouter(prefix="/api/vehicles/{vehicle_id}", tags=["bidding"])

IdempotencyKey = Annotated[
    str | None,
    Header(
        min_length=1,
        max_length=64,
        description="Retrying with the same key returns the original result instead of bidding "
        "twice.",
    ),
]

_REJECTION_RESPONSES: dict[int | str, dict[str, str]] = {
    404: {"description": "Unknown vehicle"},
    409: {"description": "Rejected against the current auction state; body has a fresh snapshot"},
    503: {"description": "Too much contention right now; retry after the Retry-After delay"},
}
# Bids are judged by the clock *inside* the locked transaction, so the service takes the clock.
ClockDep = Annotated[Clock, Depends(get_clock)]


def _message(rejection: BidRejection, vehicle: Vehicle, minimum: int) -> str:
    match rejection:
        case BidRejection.AUCTION_ENDED:
            return "This auction has ended."
        case BidRejection.ALREADY_HIGH_BIDDER:
            return "You're already the high bidder."
        case BidRejection.BID_TOO_LOW:
            return f"The minimum bid is now ${minimum:,}."
        case BidRejection.BID_TOO_HIGH:
            return (
                f"That's more than {MAX_JUMP_MULTIPLIER}x the minimum bid "
                f"(max ${max_allowed_bid(minimum):,}). "
                "Check the amount."
            )
        case BidRejection.USE_BUY_NOW:
            return (
                f"That's at or above the Buy Now price — buy it now for ${vehicle.buy_now_price:,}."
            )


def _fresh_snapshot(
    session: Session, vehicle: Vehicle, now: datetime, bidder_id: str
) -> AuctionSnapshot:
    """The auction as it stands now, sent with a rejection so the client can recover in place."""
    has_bid = bool(ids_for_bidder(session, bidder_id, Bid, [vehicle.id]))
    return snapshot(vehicle, now, bidder_id, has_bid=has_bid)


def _placed(result: BidResult, bidder_id: str, request: Request, response: Response) -> BidPlaced:
    # The service has committed by now, so subscribers never hear about a bid that rolled back.
    request.app.state.broker.publish(result)
    response.status_code = status.HTTP_200_OK if result.replayed else status.HTTP_201_CREATED
    return BidPlaced(
        bid=bid_out(result.bid, bidder_id, result.labels),
        auction=snapshot(result.vehicle, result.now, bidder_id, has_bid=True),
        extended=result.extended,
    )


@router.post("/bids", status_code=status.HTTP_201_CREATED, responses=_REJECTION_RESPONSES)
def create_bid(
    vehicle_id: str,
    body: PlaceBidRequest,
    request: Request,
    response: Response,
    session: WriteSession,
    clock: ClockDep,
    bidder_id: RequiredBidderId,
    idempotency_key: IdempotencyKey = None,
) -> BidPlaced:
    try:
        result = place_bid(
            session,
            vehicle_id=vehicle_id,
            bidder_id=bidder_id,
            amount=body.amount,
            clock=clock,
            idempotency_key=idempotency_key,
        )
    except BidRejectedError as rejected:
        fresh = _fresh_snapshot(session, rejected.vehicle, rejected.now, bidder_id)
        raise ApiError(
            409,
            rejected.rejection.value,
            _message(rejected.rejection, rejected.vehicle, fresh.min_next_bid),
            auction=fresh.model_dump(mode="json"),
        ) from None
    return _placed(result, bidder_id, request, response)


@router.post("/buy-now", status_code=status.HTTP_201_CREATED, responses=_REJECTION_RESPONSES)
def create_buy_now(
    vehicle_id: str,
    request: Request,
    response: Response,
    session: WriteSession,
    clock: ClockDep,
    bidder_id: RequiredBidderId,
    idempotency_key: IdempotencyKey = None,
) -> BidPlaced:
    try:
        result = buy_now(
            session,
            vehicle_id=vehicle_id,
            bidder_id=bidder_id,
            clock=clock,
            idempotency_key=idempotency_key,
        )
    except BuyNowUnavailableError as unavailable:
        fresh = _fresh_snapshot(session, unavailable.vehicle, unavailable.now, bidder_id)
        raise ApiError(
            409,
            "buy_now_unavailable",
            "Buy Now is no longer available on this vehicle.",
            auction=fresh.model_dump(mode="json"),
        ) from None
    return _placed(result, bidder_id, request, response)
