"""The buyer's own activity: bids they've placed and vehicles they're watching.

Shared by the My bids API and Lane's my_activity tool.
"""

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain.auction import AuctionOutcome, AuctionStatus
from app.models import Bid, Vehicle, WatchlistEntry
from app.schemas import MyBid, Standing, VehicleSummary
from app.services.inventory import ids_for_bidder, open_first_key, summarize


def _standing(
    item_status: AuctionStatus, leading: bool, outcome: AuctionOutcome | None
) -> Standing:
    if item_status is AuctionStatus.ENDED:
        return Standing.WON if leading and outcome is AuctionOutcome.SOLD else Standing.LOST
    return Standing.LEADING if leading else Standing.OUTBID


def my_bids(session: Session, now: datetime, bidder_id: str) -> list[MyBid]:
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
    items.sort(key=lambda item: open_first_key(item.auction))
    return items


def my_watchlist(session: Session, now: datetime, bidder_id: str) -> list[VehicleSummary]:
    """Every vehicle the buyer is watching, in the inventory's "ending soon" order.

    Its own endpoint rather than the inventory search: no facets or ranges to compute, no page cap.
    """
    vehicles = session.scalars(
        select(Vehicle)
        .join(WatchlistEntry, WatchlistEntry.vehicle_id == Vehicle.id)
        .where(WatchlistEntry.bidder_id == bidder_id)
    ).all()
    watched = {vehicle.id for vehicle in vehicles}  # every row, by construction
    bid_on = ids_for_bidder(session, bidder_id, Bid, watched)
    items = [summarize(vehicle, now, bidder_id, watched, bid_on) for vehicle in vehicles]
    items.sort(key=lambda item: open_first_key(item.auction))
    return items
