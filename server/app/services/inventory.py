"""Inventory search, facets and serialization."""

from collections.abc import Collection
from datetime import datetime
from typing import Any

from sqlalchemy import ColumnElement, Select, case, func, or_, select
from sqlalchemy.orm import Session

from app.domain.auction import (
    AuctionStatus,
    auction_outcome,
    auction_status,
    bid_increment,
    buy_now_available,
    max_allowed_bid,
    min_next_bid,
    reserve_status,
)
from app.domain.bidders import bidder_alias
from app.domain.damage import classify_damage, worst_severity
from app.errors import ApiError
from app.models import Bid, Vehicle, WatchlistEntry
from app.schemas import (
    AuctionSnapshot,
    BidOut,
    DamageNote,
    FacetValue,
    InventoryQuery,
    InventoryRanges,
    NumericRange,
    SortOrder,
    VehicleDetail,
    VehicleList,
    VehicleSummary,
)

RECENT_BIDS_LIMIT = 10

# Multi-select filters that also get facet counts.
FACET_COLUMNS: dict[str, Any] = {
    "make": Vehicle.make,
    "body_style": Vehicle.body_style,
    "province": Vehicle.province,
    "fuel_type": Vehicle.fuel_type,
    "drivetrain": Vehicle.drivetrain,
    "title_status": Vehicle.title_status,
}
_OPEN_STATUSES = (AuctionStatus.LIVE, AuctionStatus.UPCOMING)


def _price() -> ColumnElement[int]:
    """What a buyer would pay next, roughly: the current bid, else the starting bid."""
    return func.coalesce(Vehicle.current_bid, Vehicle.starting_bid)


def _status(now: datetime) -> ColumnElement[str]:
    # Mirrors domain.auction.auction_status so filtering happens in SQL.
    return case(
        (Vehicle.starts_at > now, AuctionStatus.UPCOMING.value),
        (Vehicle.ends_at > now, AuctionStatus.LIVE.value),
        else_=AuctionStatus.ENDED.value,
    )


def _escape_like(token: str) -> str:
    return token.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# Partial-VIN search kicks in from this many characters; shorter tokens like "x5" would match
# arbitrary VINs.
_MIN_VIN_FRAGMENT = 4


def _token_matches(token: str) -> ColumnElement[bool]:
    """Tokens match at the start of a word: "ford" finds Fords but not "Oxford White" paint, and
    "x5" finds the BMW X5. Digit-bearing tokens of 4+ characters also match anywhere in the VIN,
    because dealers look cars up by the last digits of a VIN."""
    escaped = _escape_like(token)
    matches = [
        Vehicle.search_text.like(f"{escaped}%", escape="\\"),
        Vehicle.search_text.like(f"% {escaped}%", escape="\\"),
    ]
    if len(token) >= _MIN_VIN_FRAGMENT and any(char.isdigit() for char in token):
        matches.append(func.lower(Vehicle.vin).like(f"%{escaped}%", escape="\\"))
    return or_(*matches)


def _condition_groups(
    query: InventoryQuery, now: datetime, bidder_id: str | None
) -> dict[str, list[ColumnElement[bool]]]:
    """Filter conditions keyed by facet, so a facet's counts can ignore its own selection."""
    groups: dict[str, list[ColumnElement[bool]]] = {}
    for name, column in FACET_COLUMNS.items():
        selected: list[str] = getattr(query, name)
        if selected:
            groups[name] = [column.in_(selected)]

    statuses = query.status or list(_OPEN_STATUSES)
    groups["status"] = [_status(now).in_([s.value for s in statuses])]

    rest: list[ColumnElement[bool]] = [
        _token_matches(token) for token in (query.q or "").lower().split()
    ]
    if query.year_min is not None:
        rest.append(Vehicle.year >= query.year_min)
    if query.year_max is not None:
        rest.append(Vehicle.year <= query.year_max)
    if query.price_min is not None:
        rest.append(_price() >= query.price_min)
    if query.price_max is not None:
        rest.append(_price() <= query.price_max)
    if query.odometer_max is not None:
        rest.append(Vehicle.odometer_km <= query.odometer_max)
    if query.grade_min is not None:
        rest.append(Vehicle.condition_grade >= query.grade_min)
    if query.buy_now:
        rest.append(Vehicle.buy_now_price.is_not(None))
    if query.watching:
        if bidder_id is None:
            raise ApiError(400, "bidder_id_required", "Send an X-Bidder-Id header to filter.")
        rest.append(
            Vehicle.id.in_(
                select(WatchlistEntry.vehicle_id).where(WatchlistEntry.bidder_id == bidder_id)
            )
        )
    groups["_"] = rest
    return groups


def _where(
    groups: dict[str, list[ColumnElement[bool]]], exclude: str | None = None
) -> list[ColumnElement[bool]]:
    return [cond for name, conds in groups.items() if name != exclude for cond in conds]


def _order_by(sort: SortOrder, now: datetime) -> list[Any]:
    status = _status(now)
    status_rank = case(
        (status == AuctionStatus.LIVE.value, 0),
        (status == AuctionStatus.UPCOMING.value, 1),
        else_=2,
    )
    # Live by soonest close, then upcoming by soonest open, then ended with the most recent first.
    next_moment = case(
        (status == AuctionStatus.LIVE.value, Vehicle.ends_at),
        (status == AuctionStatus.UPCOMING.value, Vehicle.starts_at),
    )
    orders: dict[SortOrder, list[Any]] = {
        SortOrder.ENDING_SOON: [status_rank, next_moment, Vehicle.ends_at.desc()],
        SortOrder.PRICE_ASC: [_price()],
        SortOrder.PRICE_DESC: [_price().desc()],
        SortOrder.YEAR_DESC: [Vehicle.year.desc(), Vehicle.odometer_km],
        SortOrder.ODOMETER_ASC: [Vehicle.odometer_km],
        SortOrder.GRADE_DESC: [Vehicle.condition_grade.desc()],
        SortOrder.MOST_BIDS: [Vehicle.bid_count.desc(), Vehicle.ends_at],
    }
    return [*orders[sort], Vehicle.lot]  # lot = stable tiebreak for pagination


def _facet_counts(
    session: Session,
    groups: dict[str, list[ColumnElement[bool]]],
    query: InventoryQuery,
    now: datetime,
) -> dict[str, list[FacetValue]]:
    facets: dict[str, list[FacetValue]] = {}
    columns: dict[str, Any] = {**FACET_COLUMNS, "status": _status(now)}
    for name, column in columns.items():
        stmt: Select[Any] = (
            select(column, func.count())
            .where(*_where(groups, exclude=name))
            .group_by(column)
            .order_by(func.count().desc(), column)
        )
        values = [FacetValue(value=value, count=count) for value, count in session.execute(stmt)]
        # A selected value can drop to zero under other filters; keep it so the UI can still
        # show it as active and let the buyer clear it.
        present = {facet.value for facet in values}
        selected = [str(value) for value in getattr(query, name)]
        values += [FacetValue(value=v, count=0) for v in selected if v not in present]
        facets[name] = values
    return facets


def _ranges(session: Session) -> InventoryRanges:
    """Whole-inventory bounds for the filter sliders (deliberately not narrowed by filters)."""
    row = session.execute(
        select(
            func.min(Vehicle.year),
            func.max(Vehicle.year),
            func.min(_price()),
            func.max(_price()),
            func.min(Vehicle.odometer_km),
            func.max(Vehicle.odometer_km),
        )
    ).one()
    year_min, year_max, price_min, price_max, km_min, km_max = (value or 0 for value in row)
    return InventoryRanges(
        year=NumericRange(min=year_min, max=year_max),
        price=NumericRange(min=price_min, max=price_max),
        odometer_km=NumericRange(min=km_min, max=km_max),
    )


def ids_for_bidder(
    session: Session, bidder_id: str | None, model: Any, vehicle_ids: Collection[str]
) -> set[str]:
    """Which of `vehicle_ids` the bidder has a row for in `model` (Bid or WatchlistEntry)."""
    if not bidder_id or not vehicle_ids:
        return set()
    return set(
        session.scalars(
            select(model.vehicle_id)
            .where(model.bidder_id == bidder_id, model.vehicle_id.in_(vehicle_ids))
            .distinct()
        )
    )


def snapshot(
    vehicle: Vehicle, now: datetime, bidder_id: str | None, has_bid: bool
) -> AuctionSnapshot:
    status = auction_status(vehicle.starts_at, vehicle.ends_at, now)
    minimum = min_next_bid(vehicle.starting_bid, vehicle.current_bid)
    return AuctionSnapshot(
        status=status,
        starts_at=vehicle.starts_at,
        ends_at=vehicle.ends_at,
        starting_bid=vehicle.starting_bid,
        current_bid=vehicle.current_bid,
        bid_count=vehicle.bid_count,
        min_next_bid=minimum,
        increment=bid_increment(
            vehicle.current_bid if vehicle.current_bid is not None else vehicle.starting_bid
        ),
        max_bid=max_allowed_bid(minimum),
        reserve_status=reserve_status(
            vehicle.reserve_price, vehicle.current_bid, vehicle.buy_now_price
        ),
        buy_now_price=vehicle.buy_now_price,
        buy_now_available=buy_now_available(status, vehicle.buy_now_price, vehicle.current_bid),
        outcome=(
            auction_outcome(vehicle.reserve_price, vehicle.current_bid, vehicle.buy_now_price)
            if status is AuctionStatus.ENDED
            else None
        ),
        is_high_bidder=bidder_id is not None and vehicle.high_bidder_id == bidder_id,
        has_bid=has_bid,
    )


def summarize(
    vehicle: Vehicle,
    now: datetime,
    bidder_id: str | None,
    watching_ids: Collection[str],
    bid_vehicle_ids: Collection[str],
) -> VehicleSummary:
    return VehicleSummary(
        **_summary_fields(vehicle),
        watching=vehicle.id in watching_ids,
        auction=snapshot(vehicle, now, bidder_id, has_bid=vehicle.id in bid_vehicle_ids),
    )


# VehicleSummary fields the server works out; every other field is copied from the Vehicle row
# as-is, so adding a column to both is all a new field needs.
COMPUTED_SUMMARY_FIELDS = frozenset(
    {"image_count", "damage_count", "worst_damage", "watching", "auction"}
)
COPIED_SUMMARY_FIELDS = tuple(
    name for name in VehicleSummary.model_fields if name not in COMPUTED_SUMMARY_FIELDS
)


def _summary_fields(vehicle: Vehicle) -> dict[str, Any]:
    return {
        **{name: getattr(vehicle, name) for name in COPIED_SUMMARY_FIELDS},
        "image_count": len(vehicle.images),
        "damage_count": len(vehicle.damage_notes),
        "worst_damage": worst_severity(vehicle.damage_notes),
    }


def get_vehicle_or_404(session: Session, vehicle_id: str) -> Vehicle:
    vehicle = session.get(Vehicle, vehicle_id)
    if vehicle is None:
        raise ApiError(404, "vehicle_not_found", "No vehicle with that id.")
    return vehicle


def open_first_key(auction: AuctionSnapshot) -> tuple[int, float]:
    """Sort key matching the inventory's "ending soon" order, for lists sorted in Python:
    live by soonest close, upcoming by soonest open, then ended with the most recent first."""
    match auction.status:
        case AuctionStatus.LIVE:
            return (0, auction.ends_at.timestamp())
        case AuctionStatus.UPCOMING:
            return (1, auction.starts_at.timestamp())
        case AuctionStatus.ENDED:
            return (2, -auction.ends_at.timestamp())


def bid_out(bid: Bid, bidder_id: str | None) -> BidOut:
    return BidOut(
        id=bid.id,
        amount=bid.amount,
        bidder=bidder_alias(bid.bidder_id),
        is_you=bidder_id is not None and bid.bidder_id == bidder_id,
        placed_at=bid.placed_at,
    )


def search_inventory(
    session: Session, query: InventoryQuery, now: datetime, bidder_id: str | None
) -> VehicleList:
    groups = _condition_groups(query, now, bidder_id)
    where = _where(groups)
    total = session.scalar(select(func.count()).select_from(Vehicle).where(*where)) or 0
    vehicles = session.scalars(
        select(Vehicle)
        .where(*where)
        .order_by(*_order_by(query.sort, now))
        .offset((query.page - 1) * query.page_size)
        .limit(query.page_size)
    ).all()

    page_ids = [vehicle.id for vehicle in vehicles]
    watching_ids = ids_for_bidder(session, bidder_id, WatchlistEntry, page_ids)
    bid_vehicle_ids = ids_for_bidder(session, bidder_id, Bid, page_ids)
    return VehicleList(
        items=[summarize(v, now, bidder_id, watching_ids, bid_vehicle_ids) for v in vehicles],
        total=total,
        page=query.page,
        page_size=query.page_size,
        facets=_facet_counts(session, groups, query, now),
        ranges=_ranges(session),
        server_time=now,
    )


def vehicle_detail(
    session: Session, vehicle: Vehicle, now: datetime, bidder_id: str | None
) -> VehicleDetail:
    watching = bool(ids_for_bidder(session, bidder_id, WatchlistEntry, [vehicle.id]))
    has_bid = bool(ids_for_bidder(session, bidder_id, Bid, [vehicle.id]))
    recent_bids = session.scalars(
        select(Bid)
        .where(Bid.vehicle_id == vehicle.id)
        .order_by(Bid.placed_at.desc(), Bid.id.desc())
        .limit(RECENT_BIDS_LIMIT)
    )
    return VehicleDetail(
        **_summary_fields(vehicle),
        watching=watching,
        auction=snapshot(vehicle, now, bidder_id, has_bid=has_bid),
        interior_color=vehicle.interior_color,
        engine=vehicle.engine,
        condition_report=vehicle.condition_report,
        damage=[DamageNote(note=n, severity=classify_damage(n)) for n in vehicle.damage_notes],
        images=vehicle.images,
        recent_bids=[bid_out(bid, bidder_id) for bid in recent_bids],
        recent_bids_limit=RECENT_BIDS_LIMIT,
        server_time=now,
    )
