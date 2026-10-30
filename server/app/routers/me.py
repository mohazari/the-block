"""The buyer's own activity: bids they've placed and vehicles they're watching."""

from fastapi import APIRouter, Response, status

from app.deps import DbSession, Now, RequiredBidderId, WriteSession
from app.models import WatchlistEntry
from app.schemas import MyBid, VehicleSummary
from app.services.inventory import get_vehicle_or_404
from app.services.me import my_bids, my_watchlist

router = APIRouter(prefix="/api/me", tags=["me"])


@router.get("/bids")
def get_my_bids(session: DbSession, now: Now, bidder_id: RequiredBidderId) -> list[MyBid]:
    """Every vehicle the buyer has bid on: open auctions closing soonest first, then ended."""
    return my_bids(session, now, bidder_id)


@router.get("/watchlist")
def get_my_watchlist(
    session: DbSession, now: Now, bidder_id: RequiredBidderId
) -> list[VehicleSummary]:
    """Every vehicle the buyer is watching, in the inventory's "ending soon" order."""
    return my_watchlist(session, now, bidder_id)


@router.put("/watchlist/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
def watch(
    vehicle_id: str, session: WriteSession, now: Now, bidder_id: RequiredBidderId
) -> Response:
    get_vehicle_or_404(session, vehicle_id)
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
