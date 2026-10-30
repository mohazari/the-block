"""Lane's tools: read-only views of the auction, run as the buyer who is chatting.

Each tool answers with compact JSON built from the same services the API uses, so Lane sees what
the buyer would see (their standing, their watchlist) and nothing they couldn't. None of them
writes: bidding, Buy Now and the watchlist stay with the buyer.
"""

import json
from datetime import datetime, tzinfo
from typing import Any

from pydantic import ValidationError
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.domain.auction import AuctionStatus
from app.models import Bid, Vehicle, WatchlistEntry
from app.schemas import InventoryQuery, SortOrder, VehicleSummary
from app.services.inventory import (
    FACET_COLUMNS,
    ids_for_bidder,
    search_inventory,
    summarize,
    vehicle_detail,
)
from app.services.me import my_bids, my_watchlist

SEARCH_LIMIT = 20
DEFAULT_SEARCH_LIMIT = 8

_LIST = {"type": "array", "items": {"type": "string"}}
_INT = {"type": "integer"}

TOOL_SPECS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "search_vehicles",
        "description": (
            "Search the auction inventory with the inventory page's filters. Open auctions only "
            "(live and upcoming) unless `status` says otherwise. Returns the total that match "
            "and the first `limit` vehicles in `sort` order."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "q": {"type": "string", "description": "Keywords, e.g. model or trim names."},
                "make": _LIST,
                "body_style": _LIST,
                "province": _LIST,
                "fuel_type": _LIST,
                "drivetrain": _LIST,
                "title_status": _LIST,
                "status": {
                    "type": "array",
                    "items": {"type": "string", "enum": [s.value for s in AuctionStatus]},
                },
                "year_min": _INT,
                "year_max": _INT,
                "price_min": {**_INT, "description": "Current bid, else starting bid (CAD)."},
                "price_max": {**_INT, "description": "Current bid, else starting bid (CAD)."},
                "odometer_max": {**_INT, "description": "Kilometres."},
                "grade_min": {"type": "number", "description": "Condition grade, 1 to 5."},
                "buy_now": {"type": "boolean", "description": "Only cars with a Buy Now price."},
                "watching": {"type": "boolean", "description": "Only the buyer's watchlist."},
                "sort": {"type": "string", "enum": [s.value for s in SortOrder]},
                "limit": {"type": "integer", "minimum": 1, "maximum": SEARCH_LIMIT},
            },
            "additionalProperties": False,
        },
    },
    {
        "type": "function",
        "name": "get_vehicle",
        "description": (
            "Everything about one vehicle: specs, the condition report, each damage note with "
            "its severity, the seller, and the latest bids."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"vehicle_id": {"type": "string"}},
            "required": ["vehicle_id"],
            "additionalProperties": False,
        },
    },
    {
        "type": "function",
        "name": "my_activity",
        "description": "The buyer's own bids (and whether they lead) and their watchlist.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
]


class ToolError(Exception):
    """A tool call Lane got wrong: the message goes back to the model so it can correct it."""


def _minutes_until(moment: datetime, now: datetime) -> int:
    return max(0, round((moment - now).total_seconds() / 60))


def _local(moment: datetime, zone: tzinfo) -> str:
    return f"{moment.astimezone(zone):%a %Y-%m-%d %H:%M}"


def brief(vehicle: VehicleSummary, now: datetime, zone: tzinfo | None = None) -> dict[str, Any]:
    """The facts a buyer weighs, compact enough to send twenty of. With the buyer's time zone,
    close and open times are also given on their clock, so "today" needs no arithmetic."""
    auction = vehicle.auction
    facts: dict[str, Any] = {
        "id": vehicle.id,
        "name": f"{vehicle.year} {vehicle.make} {vehicle.model} {vehicle.trim}",
        "lot": vehicle.lot,
        "body_style": vehicle.body_style,
        "odometer_km": vehicle.odometer_km,
        "condition_grade": vehicle.condition_grade,
        "title_status": vehicle.title_status,
        "fuel_type": vehicle.fuel_type,
        "drivetrain": vehicle.drivetrain,
        "colour": vehicle.exterior_color,
        "location": f"{vehicle.city}, {vehicle.province}",
        "damage_notes": vehicle.damage_count,
        "worst_damage": vehicle.worst_damage,
        "status": auction.status,
        "current_bid": auction.current_bid,
        "starting_bid": auction.starting_bid,
        "bids": auction.bid_count,
        "reserve": auction.reserve_status,
        "buy_now_price": auction.buy_now_price if auction.buy_now_available else None,
    }
    if auction.status is AuctionStatus.LIVE:
        facts["ends_in_minutes"] = _minutes_until(auction.ends_at, now)
        if zone is not None:
            facts["ends_at_local"] = _local(auction.ends_at, zone)
    elif auction.status is AuctionStatus.UPCOMING:
        facts["opens_in_minutes"] = _minutes_until(auction.starts_at, now)
        if zone is not None:
            facts["opens_at_local"] = _local(auction.starts_at, zone)
    if vehicle.watching:
        facts["watching"] = True
    if auction.has_bid:
        facts["you_lead"] = auction.is_high_bidder
    return facts


def search_query(arguments: dict[str, Any]) -> InventoryQuery:
    """The tool's arguments as the inventory's own query; raises ToolError if they don't fit."""
    filters = {key: value for key, value in arguments.items() if key != "limit"}
    limit = arguments.get("limit", DEFAULT_SEARCH_LIMIT)
    if not isinstance(limit, int) or not 1 <= limit <= SEARCH_LIMIT:
        raise ToolError(f"limit must be a whole number from 1 to {SEARCH_LIMIT}.")
    try:
        return InventoryQuery(**filters, page_size=limit)
    except ValidationError as exc:
        problems = "; ".join(
            f"{'.'.join(str(p) for p in error['loc']) or 'query'}: {error['msg']}"
            for error in exc.errors()
        )
        raise ToolError(f"Invalid search: {problems}") from exc


def run_tool(
    name: str,
    arguments: dict[str, Any],
    session: Session,
    now: datetime,
    bidder_id: str,
    zone: tzinfo | None = None,
) -> dict[str, Any]:
    """Run one tool and return its JSON-able result."""
    if name == "search_vehicles":
        result = search_inventory(session, search_query(arguments), now, bidder_id)
        return {
            "total": result.total,
            "vehicles": [brief(vehicle, now, zone) for vehicle in result.items],
        }
    if name == "get_vehicle":
        vehicle = session.get(Vehicle, str(arguments.get("vehicle_id", "")))
        if vehicle is None:
            raise ToolError("No vehicle with that id. Use an id from search_vehicles.")
        detail = vehicle_detail(session, vehicle, now, bidder_id)
        return {
            **brief(detail, now, zone),
            "vin": detail.vin,
            "engine": detail.engine,
            "transmission": detail.transmission,
            "interior_colour": detail.interior_color,
            "seller": detail.selling_dealership,
            "condition_report": detail.condition_report,
            "damage": [{"note": d.note, "severity": d.severity} for d in detail.damage],
            "min_next_bid": detail.auction.min_next_bid,
            "recent_bids": [bid.amount for bid in detail.recent_bids],
        }
    if name == "my_activity":
        return {
            "bids": [
                {**brief(bid, now, zone), "your_top_bid": bid.my_top_bid, "standing": bid.standing}
                for bid in my_bids(session, now, bidder_id)
            ],
            "watching": [brief(v, now, zone) for v in my_watchlist(session, now, bidder_id)],
        }
    raise ToolError(f"There is no tool called {name}.")


def as_text(result: dict[str, Any]) -> str:
    return json.dumps(result, separators=(",", ":"), default=str)


def filter_values(session: Session) -> dict[str, list[str]]:
    """Every value each list filter can take, for Lane's instructions."""
    return {
        name: sorted(str(value) for value in session.scalars(select(column).distinct()))
        for name, column in FACET_COLUMNS.items()
    }


def summaries(
    session: Session, keys: list[str], now: datetime, bidder_id: str
) -> dict[str, VehicleSummary]:
    """Fresh summaries of the vehicles Lane picked, as the buyer would see them, by the id or
    lot number Lane gave. Unknown keys are left out: Lane can only recommend cars that exist."""
    vehicles = session.scalars(
        select(Vehicle).where(or_(Vehicle.id.in_(keys), Vehicle.lot.in_(keys)))
    ).all()
    ids = [vehicle.id for vehicle in vehicles]
    watching = ids_for_bidder(session, bidder_id, WatchlistEntry, ids)
    bid_on = ids_for_bidder(session, bidder_id, Bid, ids)
    found: dict[str, VehicleSummary] = {}
    for vehicle in vehicles:
        summary = summarize(vehicle, now, bidder_id, watching, bid_on)
        found[vehicle.id] = found[vehicle.lot] = summary
    return found
