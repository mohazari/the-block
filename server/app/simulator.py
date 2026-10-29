"""Simulated rival dealers, so the marketplace feels alive in a single-user demo.

Rules aim for *plausible*, not rigged:
- A rival only counters a human leader after they have led for a while, so being outbid never
  feels instant or automatic.
- Each vehicle has a private ceiling per run (near the reserve, or a markup over the starting bid
  when there is none). Rivals drop out above it — a determined buyer can always win.
- Most activity lands on auctions closing soon, where real bidding concentrates.

Rivals bid through the same `place_bid` service as everyone else, so every rule (increments,
soft close, Buy Now guard, locking) applies to them too.
"""

import asyncio
import logging
import random
from collections.abc import Callable
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.clock import Clock
from app.domain.auction import AuctionStatus, auction_status, bid_increment, min_next_bid
from app.domain.bidders import RIVAL_BIDDER_IDS
from app.models import Vehicle
from app.services.bidding import BidRejectedError, BidResult, place_bid

logger = logging.getLogger(__name__)

# How long a human must have led before a rival may counter.
HUMAN_LEAD_GRACE = timedelta(seconds=20)
# Chance a tick goes after a human-led auction (when one is eligible).
COUNTER_HUMAN_CHANCE = 0.6
# Random ticks pick among this many auctions closing soonest.
HOT_LOTS = 15


class RivalSimulator:
    def __init__(
        self,
        sessions: sessionmaker[Session],
        clock: Clock,
        on_bid: Callable[[BidResult], None],
        rng: random.Random | None = None,
    ) -> None:
        self._sessions = sessions  # must be write sessions (BEGIN IMMEDIATE)
        self._clock = clock
        self._on_bid = on_bid
        self._rng = rng or random.Random()
        self._ceilings: dict[str, int] = {}

    def ceiling(self, vehicle: Vehicle) -> int:
        """The most any rival will pay for this vehicle in this run."""
        if vehicle.id not in self._ceilings:
            if vehicle.reserve_price is not None:
                base = vehicle.reserve_price * self._rng.uniform(0.92, 1.08)
            else:
                base = vehicle.starting_bid * self._rng.uniform(1.3, 1.6)
            if vehicle.buy_now_price is not None:
                base = min(base, vehicle.buy_now_price - 1)
            self._ceilings[vehicle.id] = int(base)
        return self._ceilings[vehicle.id]

    def _candidates(self, session: Session) -> list[Vehicle]:
        now = self._clock.now()
        open_lots = session.scalars(
            select(Vehicle).where(Vehicle.ends_at > now).order_by(Vehicle.ends_at)
        ).all()
        affordable = [
            v for v in open_lots if min_next_bid(v.starting_bid, v.current_bid) <= self.ceiling(v)
        ]

        human_led = [
            v
            for v in affordable
            if v.high_bidder_id is not None
            and v.high_bidder_id not in RIVAL_BIDDER_IDS
            and now - v.bids[0].placed_at >= HUMAN_LEAD_GRACE
        ]
        if human_led and self._rng.random() < COUNTER_HUMAN_CHANCE:
            return human_led

        live = [
            v
            for v in affordable
            if auction_status(v.starts_at, v.ends_at, now) is AuctionStatus.LIVE
        ]
        return live[:HOT_LOTS]

    def tick(self) -> BidResult | None:
        """Place at most one rival bid. Returns it, or None if no rival wanted to bid."""
        with self._sessions() as session:
            candidates = self._candidates(session)
            if not candidates:
                return None
            vehicle = self._rng.choice(candidates)
            minimum = min_next_bid(vehicle.starting_bid, vehicle.current_bid)
            # Usually the minimum, sometimes a jump bid — but never past the ceiling.
            jump = bid_increment(minimum) * self._rng.choice((0, 0, 0, 1, 2))
            amount = min(minimum + jump, self.ceiling(vehicle))
            bidder = self._rng.choice([b for b in RIVAL_BIDDER_IDS if b != vehicle.high_bidder_id])
            try:
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
            try:
                await asyncio.to_thread(self.tick)
            except Exception:  # keep the simulator alive; one bad tick shouldn't stop the market
                logger.exception("Rival simulator tick failed")
