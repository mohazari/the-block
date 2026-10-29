"""The buyer's own activity: bids they've placed and vehicles they're watching."""

from datetime import datetime

from fastapi import APIRouter, Response, status
from sqlalchemy import func, select

from app.deps import DbSession, Now, RequiredBidderId, WriteSession
from app.domain.auction import AuctionOutcome, AuctionStatus
from app.errors import ApiError
from app.models import Bid, Vehicle, WatchlistEntry
from app.schemas import MyBid, Standing
from app.services.inventory import ids_for_bidder, summarize

router = APIRouter(prefix="/api/me", tags=["me"])


def _standing(
    item_status: AuctionStatus, leading: bool, outcome: AuctionOutcome | None
) -> Standing:
    if item_status is AuctionStatus.ENDED:
        return Standing.WON if leading and outcome is AuctionOutcome.SOLD else Standing.LOST
    return Standing.LEADING if leading else Standing.OUTBID


@router.get("/bids")
def my_bids(session: DbSession, now: Now, bidder_id: RequiredBidderId) -> list[MyBid]:
    """Every vehicle the buyer has bid on: open auctions closing soonest first, then ended."""
    mine: dict[str, tuple[int, datetime]] = {
        vehicle_id: (top, last)
        for vehicle_id, top, last in session.execute(
            select(Bid.vehicle_id, func.max(Bid.amount), func.max(Bid.placed_at))
            .where(Bid.bidder_id == bidder_id)
            .group_by(Bid.vehicle_id)
        )
    }
    vehicles = session.scalars(select(Vehicle).where(Vehicle.id.in_(mine))).all()
    watching = ids_for_bidder(session, bidder_id, WatchlistEntry, mine.keys())

    items: list[MyBid] = []
    for vehicle in vehicles:
        summary = summarize(vehicle, now, bidder_id, watching, mine.keys())
        auction = summary.auction
        top, last = mine[vehicle.id]
        items.append(
            MyBid(
                **summary.model_dump(),
                my_top_bid=top,
                my_last_bid_at=last,
                standing=_standing(auction.status, auction.is_high_bidder, auction.outcome),
            )
        )
    items.sort(
        key=lambda item: (
            item.auction.status is AuctionStatus.ENDED,
            item.auction.ends_at.timestamp()
            * (-1 if item.auction.status is AuctionStatus.ENDED else 1),
        )
    )
    return items


@router.put("/watchlist/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
def watch(
    vehicle_id: str, session: WriteSession, now: Now, bidder_id: RequiredBidderId
) -> Response:
    if session.get(Vehicle, vehicle_id) is None:
        raise ApiError(404, "vehicle_not_found", "No vehicle with that id.")
    key = {"bidder_id": bidder_id, "vehicle_id": vehicle_id}
    if session.get(WatchlistEntry, key) is None:  # PUT is idempotent
        session.add(WatchlistEntry(**key, created_at=now))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/watchlist/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
def unwatch(vehicle_id: str, session: WriteSession, bidder_id: RequiredBidderId) -> Response:
    entry = session.get(WatchlistEntry, {"bidder_id": bidder_id, "vehicle_id": vehicle_id})
    if entry is not None:
        session.delete(entry)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
