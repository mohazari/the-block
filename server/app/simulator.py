"""Simulated rival dealers, so the marketplace feels alive in a single-user demo.

Rules aim for *plausible*, not rigged:
- Rivals only bid on live auctions. They counter a human leader only after the human has led for
  a while, so being outbid never feels instant or automatic, and never touch pre-bids.
- Each vehicle has a private ceiling per run (near the reserve, or a markup over the starting bid
  when there is none). Rivals drop out above it — a determined buyer can always win.
- Most activity lands on auctions closing soon, where real bidding concentrates.

Rivals bid through the same `place_bid` service as everyone else, so every rule (increments,
soft close, Buy Now guard, locking) applies to them too. Choosing a target only reads; the write
lock is taken just for the bid itself, so the simulator never makes a human wait.
"""

import asyncio
import logging
import random
from collections.abc import Callable
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.clock import Clock
from app.domain.auction import bid_increment, min_next_bid
from app.domain.bidders import RIVAL_BIDDER_IDS
from app.models import Bid, Vehicle
from app.services.bidding import BidRejectedError, BidResult, place_bid

logger = logging.getLogger(__name__)

# How long a human must have led before a rival may counter.
HUMAN_LEAD_GRACE = timedelta(seconds=20)
# Chance a tick goes after a human-led auction (when one is eligible).
COUNTER_HUMAN_CHANCE = 0.6
# Random ticks pick among this many live auctions closing soonest.
HOT_LOTS = 15


class RivalSimulator:
    def __init__(
        self,
        read_sessions: sessionmaker[Session],
        write_sessions: sessionmaker[Session],
        clock: Clock,
        on_bid: Callable[[BidResult], None],
        rng: random.Random | None = None,
    ) -> None:
        self._read_sessions = read_sessions
        self._write_sessions = write_sessions  # BEGIN IMMEDIATE
        self._clock = clock
        self._on_bid = on_bid
        self._rng = rng or random.Random()
        # Ceilings are derived from (salt, vehicle id): stable for the run, nothing to store.
        self._salt = self._rng.getrandbits(32)

    def ceiling(self, vehicle: Vehicle) -> int:
        """The most any rival will pay for this vehicle in this run."""
        rng = random.Random(f"{self._salt}:{vehicle.id}")
        if vehicle.reserve_price is not None:
            base = vehicle.reserve_price * rng.uniform(0.92, 1.08)
        else:
            base = vehicle.starting_bid * rng.uniform(1.3, 1.6)
        if vehicle.buy_now_price is not None:
            base = min(base, vehicle.buy_now_price - 1)
        return int(base)

    def _candidates(self, session: Session, now: datetime) -> list[Vehicle]:
        live = session.scalars(
            select(Vehicle)
            .where(Vehicle.starts_at <= now, Vehicle.ends_at > now)
            .order_by(Vehicle.ends_at)
        ).all()
        affordable = [
            v for v in live if min_next_bid(v.starting_bid, v.current_bid) <= self.ceiling(v)
        ]

        human_led = [
            v.id
            for v in affordable
            if v.high_bidder_id is not None and v.high_bidder_id not in RIVAL_BIDDER_IDS
        ]
        last_bid_at = dict(
            session.execute(
                select(Bid.vehicle_id, func.max(Bid.placed_at))
                .where(Bid.vehicle_id.in_(human_led))
                .group_by(Bid.vehicle_id)
            ).all()
        )
        ready = [
            v
            for v in affordable
            if v.id in last_bid_at and now - last_bid_at[v.id] >= HUMAN_LEAD_GRACE
        ]
        if ready and self._rng.random() < COUNTER_HUMAN_CHANCE:
            return ready
        return affordable[:HOT_LOTS]

    def tick(self) -> BidResult | None:
        """Place at most one rival bid. Returns it, or None if no rival wanted to bid."""
        with self._read_sessions() as session:
            candidates = self._candidates(session, self._clock.now())
            if not candidates:
                return None
            vehicle = self._rng.choice(candidates)
            minimum = min_next_bid(vehicle.starting_bid, vehicle.current_bid)
            # Usually the minimum, sometimes a jump bid — but never past the ceiling.
            jump = bid_increment(minimum) * self._rng.choice((0, 0, 0, 1, 2))
            amount = min(minimum + jump, self.ceiling(vehicle))
            bidder = self._rng.choice([b for b in RIVAL_BIDDER_IDS if b != vehicle.high_bidder_id])

        with self._write_sessions() as session:
            try:
                # Re-validated under the lock: if a human bid in between, this is simply refused.
                result = place_bid(
                    session,
                    vehicle_id=vehicle.id,
                    bidder_id=bidder,
                    amount=amount,
                    clock=self._clock,
                )
            except BidRejectedError as rejected:
                logger.debug("Rival bid rejected: %s", rejected.rejection)
                return None
        self._on_bid(result)
        return result

    async def run(self, interval: tuple[float, float] = (4.0, 9.0)) -> None:
        while True:
            await asyncio.sleep(self._rng.uniform(*interval))
            tick = asyncio.ensure_future(asyncio.to_thread(self.tick))
            try:
                await asyncio.shield(tick)
            except asyncio.CancelledError:
                # Shutting down: let an in-flight bid finish before the engine is disposed.
                await asyncio.gather(tick, return_exceptions=True)
                raise
            except Exception:  # keep the simulator alive; one bad tick shouldn't stop the market
                logger.exception("Rival simulator tick failed")
