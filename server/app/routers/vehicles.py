from typing import Annotated

from fastapi import APIRouter, Query

from app.deps import BidderId, DbSession, Now
from app.errors import ApiError
from app.models import Vehicle
from app.schemas import InventoryQuery, VehicleDetail, VehicleList
from app.services.inventory import search_inventory, vehicle_detail

router = APIRouter(prefix="/api/vehicles", tags=["vehicles"])


@router.get("")
def list_vehicles(
    query: Annotated[InventoryQuery, Query()], session: DbSession, now: Now, bidder_id: BidderId
) -> VehicleList:
    """Search and filter inventory. Facet counts ignore their own facet's selection."""
    return search_inventory(session, query, now, bidder_id)


@router.get("/{vehicle_id}", responses={404: {"description": "Unknown vehicle"}})
def get_vehicle(
    vehicle_id: str, session: DbSession, now: Now, bidder_id: BidderId
) -> VehicleDetail:
    vehicle = session.get(Vehicle, vehicle_id)
    if vehicle is None:
        raise ApiError(404, "vehicle_not_found", "No vehicle with that id.")
    return vehicle_detail(session, vehicle, now, bidder_id)
