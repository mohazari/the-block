"""API contract.

These models are the only shapes that leave the server, which is what keeps `reserve_price` and
raw bidder ids private: they simply have no field here.
"""

from datetime import datetime
from enum import StrEnum
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domain.auction import AuctionOutcome, AuctionStatus, ReserveStatus
from app.domain.damage import DamageSeverity


class SortOrder(StrEnum):
    ENDING_SOON = "ending_soon"
    PRICE_ASC = "price_asc"
    PRICE_DESC = "price_desc"
    YEAR_DESC = "year_desc"
    ODOMETER_ASC = "odometer_asc"
    GRADE_DESC = "grade_desc"
    MOST_BIDS = "most_bids"


class InventoryQuery(BaseModel):
    """Query-string filters for GET /api/vehicles.

    Repeat a key to multi-select: `?make=Ford&make=BMW`.
    """

    model_config = ConfigDict(extra="forbid")

    q: str | None = Field(default=None, max_length=100, description="Keywords; all must match.")
    make: list[str] = []
    body_style: list[str] = []
    province: list[str] = []
    fuel_type: list[str] = []
    drivetrain: list[str] = []
    title_status: list[str] = []
    status: list[AuctionStatus] = Field(default=[], description="Defaults to live + upcoming.")
    year_min: int | None = Field(default=None, ge=1900, le=2100)
    year_max: int | None = Field(default=None, ge=1900, le=2100)
    price_min: int | None = Field(default=None, ge=0)
    price_max: int | None = Field(default=None, ge=0)
    odometer_max: int | None = Field(default=None, ge=0)
    grade_min: float | None = Field(default=None, ge=1, le=5)
    buy_now: bool = False
    watching: bool = False
    sort: SortOrder = SortOrder.ENDING_SOON
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=24, ge=1, le=100)

    @model_validator(mode="after")
    def _ranges_are_ordered(self) -> Self:
        for low, high in (("year_min", "year_max"), ("price_min", "price_max")):
            low_value, high_value = getattr(self, low), getattr(self, high)
            if low_value is not None and high_value is not None and low_value > high_value:
                raise ValueError(f"{low} must not exceed {high}")
        return self


class AuctionSnapshot(BaseModel):
    status: AuctionStatus
    starts_at: datetime
    ends_at: datetime
    starting_bid: int
    current_bid: int | None
    bid_count: int
    min_next_bid: int
    increment: int
    max_bid: int = Field(description="Largest single bid accepted right now (fat-finger guard).")
    reserve_status: ReserveStatus
    buy_now_price: int | None
    buy_now_available: bool
    outcome: AuctionOutcome | None = Field(description="Set once the auction has ended.")
    is_high_bidder: bool = Field(description="The requesting bidder currently leads.")
    has_bid: bool = Field(description="The requesting bidder has bid on this vehicle.")


class VehicleSummary(BaseModel):
    id: str
    lot: str
    vin: str
    year: int
    make: str
    model: str
    trim: str
    body_style: str
    exterior_color: str
    transmission: str
    drivetrain: str
    fuel_type: str
    odometer_km: int
    condition_grade: float
    title_status: str
    city: str
    province: str
    selling_dealership: str
    image_count: int
    damage_count: int
    worst_damage: DamageSeverity | None
    watching: bool
    auction: AuctionSnapshot


class DamageNote(BaseModel):
    note: str
    severity: DamageSeverity


class BidOut(BaseModel):
    id: int
    amount: int
    bidder: str = Field(description='Anonymous alias, e.g. "Bidder 4821".')
    is_you: bool
    placed_at: datetime


class VehicleDetail(VehicleSummary):
    interior_color: str
    engine: str
    condition_report: str
    damage: list[DamageNote]
    images: list[str]
    recent_bids: list[BidOut]
    recent_bids_limit: int = Field(description="How many recent bids the history keeps.")
    server_time: datetime


class FacetValue(BaseModel):
    value: str
    count: int


class NumericRange(BaseModel):
    min: int
    max: int


class InventoryRanges(BaseModel):
    year: NumericRange
    price: NumericRange
    odometer_km: NumericRange


class VehicleList(BaseModel):
    items: list[VehicleSummary]
    total: int
    page: int
    page_size: int
    facets: dict[str, list[FacetValue]]
    ranges: InventoryRanges
    server_time: datetime


class PlaceBidRequest(BaseModel):
    amount: int = Field(gt=0, le=10_000_000, description="Whole dollars.")


class BidPlaced(BaseModel):
    bid: BidOut
    auction: AuctionSnapshot
    extended: bool = Field(description="The bid landed in the soft-close window and moved the end.")


class Standing(StrEnum):
    LEADING = "leading"
    OUTBID = "outbid"
    WON = "won"
    LOST = "lost"


class MyBid(VehicleSummary):
    my_top_bid: int
    my_last_bid_at: datetime
    standing: Standing


class AuctionEvent(BaseModel):
    """One live update on /api/events, personalized for the subscribing bidder."""

    type: Literal["bid", "sold"]
    vehicle_id: str
    vehicle_title: str = Field(description='e.g. "2023 Ford Bronco", for notifications.')
    auction: AuctionSnapshot
    bid: BidOut
    outbid_you: bool = Field(description="You led until this bid.")
    extended: bool
