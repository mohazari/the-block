"""Inventory search, facets and serialization."""

from collections.abc import Collection
from datetime import datetime
from typing import Any

from sqlalchemy import ColumnElement, Select, case, false, func, select
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

    rest: list[ColumnElement[bool]] = []
    for token in (query.q or "").lower().split():
        rest.append(Vehicle.search_text.like(f"%{_escape_like(token)}%", escape="\\"))
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
        rest.append(
            Vehicle.id.in_(
                select(WatchlistEntry.vehicle_id).where(WatchlistEntry.bidder_id == bidder_id)
            )
            if bidder_id
            else false()
        )
    groups["_"] = rest
    return groups


def _where(
    groups: dict[str, list[ColumnElement[bool]]], exclude: str | None = None
) -> list[ColumnElement[bool]]:
    return [cond for name, conds in groups.items() if name != exclude for cond in conds]


def _order_by(sort: SortOrder, now: datetime) -> list[Any]:
    ended_last = case((Vehicle.ends_at <= now, 1), else_=0)
    orders: dict[SortOrder, list[Any]] = {
        # Live auctions always close before upcoming ones open + 4 days, so ends_at alone gives
        # "closing soonest" across both.
        SortOrder.ENDING_SOON: [ended_last, Vehicle.ends_at],
        SortOrder.PRICE_ASC: [_price()],
        SortOrder.PRICE_DESC: [_price().desc()],
        SortOrder.YEAR_DESC: [Vehicle.year.desc(), Vehicle.odometer_km],
        SortOrder.ODOMETER_ASC: [Vehicle.odometer_km],
        SortOrder.GRADE_DESC: [Vehicle.condition_grade.desc()],
        SortOrder.MOST_BIDS: [Vehicle.bid_count.desc(), Vehicle.ends_at],
    }
    return [*orders[sort], Vehicle.lot]  # lot = stable tiebreak for pagination


def _facet_counts(
    session: Session, groups: dict[str, list[ColumnElement[bool]]], now: datetime
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
        facets[name] = [
            FacetValue(value=value, count=count) for value, count in session.execute(stmt)
        ]
    return facets


def _ranges(session: Session) -> InventoryRanges:
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
    return InventoryRanges(
        year=NumericRange(min=row[0], max=row[1]),
        price=NumericRange(min=row[2], max=row[3]),
        odometer_km=NumericRange(min=row[4], max=row[5]),
    )


def _ids_for_bidder(session: Session, bidder_id: str | None, model: Any) -> set[str]:
    if not bidder_id:
        return set()
    return set(session.scalars(select(model.vehicle_id).where(model.bidder_id == bidder_id)))


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
        increment=bid_increment(vehicle.current_bid or vehicle.starting_bid),
        max_bid=max_allowed_bid(minimum),
        reserve_status=reserve_status(vehicle.reserve_price, vehicle.current_bid),
        buy_now_price=vehicle.buy_now_price,
        buy_now_available=buy_now_available(status, vehicle.buy_now_price, vehicle.current_bid),
        outcome=(
            auction_outcome(vehicle.reserve_price, vehicle.current_bid)
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


def _summary_fields(vehicle: Vehicle) -> dict[str, Any]:
    names = (
        "id", "lot", "vin", "year", "make", "model", "trim", "body_style", "exterior_color",
        "transmission", "drivetrain", "fuel_type", "odometer_km", "condition_grade",
        "title_status", "city", "province", "selling_dealership",
    )  # fmt: skip
    return {
        **{name: getattr(vehicle, name) for name in names},
        "image_count": len(vehicle.images),
        "damage_count": len(vehicle.damage_notes),
        "worst_damage": worst_severity(vehicle.damage_notes),
    }


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

    watching_ids = _ids_for_bidder(session, bidder_id, WatchlistEntry)
    bid_vehicle_ids = _ids_for_bidder(session, bidder_id, Bid)
    return VehicleList(
        items=[summarize(v, now, bidder_id, watching_ids, bid_vehicle_ids) for v in vehicles],
        total=total,
        page=query.page,
        page_size=query.page_size,
        facets=_facet_counts(session, groups, now),
        ranges=_ranges(session),
        server_time=now,
    )


def vehicle_detail(
    session: Session, vehicle: Vehicle, now: datetime, bidder_id: str | None
) -> VehicleDetail:
    watching = bool(
        bidder_id
        and session.get(WatchlistEntry, {"bidder_id": bidder_id, "vehicle_id": vehicle.id})
    )
    has_bid = bidder_id is not None and any(bid.bidder_id == bidder_id for bid in vehicle.bids)
    return VehicleDetail(
        **_summary_fields(vehicle),
        watching=watching,
        auction=snapshot(vehicle, now, bidder_id, has_bid=has_bid),
        interior_color=vehicle.interior_color,
        engine=vehicle.engine,
        condition_report=vehicle.condition_report,
        damage=[DamageNote(note=n, severity=classify_damage(n)) for n in vehicle.damage_notes],
        images=vehicle.images,
        recent_bids=[bid_out(bid, bidder_id) for bid in vehicle.bids[:RECENT_BIDS_LIMIT]],
        server_time=now,
    )
