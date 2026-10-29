"""Database tables.

Money is stored as whole dollars in integers — never floats. Auction *status* is not stored: it is
derived from `starts_at` / `ends_at` against the clock, so it can never go stale and needs no
background job to flip states.
"""

from datetime import datetime

from sqlalchemy import JSON, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.db import UTCDateTime


class Base(DeclarativeBase):
    pass


class Vehicle(Base):
    __tablename__ = "vehicles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    lot: Mapped[str] = mapped_column(String(16), unique=True)
    vin: Mapped[str] = mapped_column(String(17), unique=True)

    year: Mapped[int]
    make: Mapped[str] = mapped_column(index=True)
    model: Mapped[str]
    trim: Mapped[str]
    body_style: Mapped[str] = mapped_column(index=True)
    exterior_color: Mapped[str]
    interior_color: Mapped[str]
    engine: Mapped[str]
    transmission: Mapped[str]
    drivetrain: Mapped[str]
    fuel_type: Mapped[str]
    odometer_km: Mapped[int]

    condition_grade: Mapped[float]
    condition_report: Mapped[str]
    damage_notes: Mapped[list[str]] = mapped_column(JSON)
    title_status: Mapped[str]

    province: Mapped[str] = mapped_column(index=True)
    city: Mapped[str]
    selling_dealership: Mapped[str]
    images: Mapped[list[str]] = mapped_column(JSON)

    starts_at: Mapped[datetime] = mapped_column(UTCDateTime)
    ends_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    starting_bid: Mapped[int]
    # Server-only: never serialised to buyers, who only learn whether it has been met.
    reserve_price: Mapped[int | None]
    buy_now_price: Mapped[int | None]

    # Denormalised from `bids` so listing and sorting stay single-table queries. Updated only
    # inside the bid transaction.
    current_bid: Mapped[int | None]
    bid_count: Mapped[int] = mapped_column(default=0)
    high_bidder_id: Mapped[str | None]

    # Lower-cased "year make model trim vin lot dealer city province…" for keyword search.
    search_text: Mapped[str]

    bids: Mapped[list["Bid"]] = relationship(
        back_populates="vehicle", order_by="Bid.placed_at.desc()"
    )


class Bid(Base):
    __tablename__ = "bids"
    __table_args__ = (
        # Retrying a request with the same key returns the original bid instead of bidding twice.
        UniqueConstraint("bidder_id", "idempotency_key"),
        Index("ix_bids_vehicle_placed", "vehicle_id", "placed_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    vehicle_id: Mapped[str] = mapped_column(ForeignKey("vehicles.id"))
    bidder_id: Mapped[str] = mapped_column(index=True)
    amount: Mapped[int]
    placed_at: Mapped[datetime] = mapped_column(UTCDateTime)
    idempotency_key: Mapped[str | None]

    vehicle: Mapped[Vehicle] = relationship(back_populates="bids")


class WatchlistEntry(Base):
    __tablename__ = "watchlist"

    bidder_id: Mapped[str] = mapped_column(primary_key=True)
    vehicle_id: Mapped[str] = mapped_column(ForeignKey("vehicles.id"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)


class Meta(Base):
    """Key/value facts about the seeded data set (e.g. when the clock was anchored)."""

    __tablename__ = "meta"

    key: Mapped[str] = mapped_column(primary_key=True)
    value: Mapped[str]
