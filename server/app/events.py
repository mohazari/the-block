"""In-process pub/sub for live auction updates.

Bids are written from FastAPI's threadpool (sync endpoints) and from the simulator thread, but SSE
subscribers live on the event loop. `publish()` is therefore thread-safe: it hops onto the loop
with `call_soon_threadsafe` and fans the event out to every subscriber's queue.

Each event is personalized at delivery: the same bid is "you're winning" for one subscriber,
"you've been outbid" for the previous leader, and a plain price update for everyone else.

A single process is enough for this prototype; with several API workers this would move to a
shared channel such as Redis pub/sub or Postgres LISTEN/NOTIFY.
"""

import asyncio
import itertools
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Literal

from app.schemas import AuctionEvent, AuctionSnapshot, BidOut
from app.services.bidding import BidResult
from app.services.inventory import bid_out, snapshot

logger = logging.getLogger(__name__)

_QUEUE_SIZE = 256


@dataclass(frozen=True)
class BidEvent:
    """A committed bid (or Buy Now), before personalization."""

    kind: Literal["bid", "sold"]
    vehicle_id: str
    auction: AuctionSnapshot  # computed for nobody: is_high_bidder / has_bid are False
    bid: BidOut  # is_you is False
    bidder_id: str
    previous_high_bidder: str | None
    extended: bool

    @classmethod
    def from_result(cls, result: BidResult) -> "BidEvent":
        return cls(
            kind="sold" if result.bid.kind == "buy_now" else "bid",
            vehicle_id=result.vehicle.id,
            auction=snapshot(result.vehicle, result.now, bidder_id=None, has_bid=False),
            bid=bid_out(result.bid, bidder_id=None),
            bidder_id=result.bid.bidder_id,
            previous_high_bidder=result.previous_high_bidder,
            extended=result.extended,
        )

    def for_subscriber(self, bidder_id: str | None) -> AuctionEvent:
        is_bidder = bidder_id is not None and bidder_id == self.bidder_id
        outbid_you = (
            bidder_id is not None and bidder_id == self.previous_high_bidder and not is_bidder
        )
        return AuctionEvent(
            type=self.kind,
            vehicle_id=self.vehicle_id,
            # has_bid is a lower bound here; clients keep their own `has_bid` if already true.
            auction=self.auction.model_copy(
                update={"is_high_bidder": is_bidder, "has_bid": is_bidder or outbid_you}
            ),
            bid=self.bid.model_copy(update={"is_you": is_bidder}),
            outbid_you=outbid_you,
            extended=self.extended,
        )


@dataclass(eq=False)
class Subscriber:
    bidder_id: str | None
    # None is a sentinel: "your stream is over, reconnect".
    queue: asyncio.Queue[BidEvent | None] = field(
        default_factory=lambda: asyncio.Queue(_QUEUE_SIZE)
    )


class EventBroker:
    def __init__(self) -> None:
        self._subscribers: set[Subscriber] = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._ids = itertools.count(1)

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def next_id(self) -> int:
        return next(self._ids)

    @asynccontextmanager
    async def subscribe(self, bidder_id: str | None) -> AsyncIterator[Subscriber]:
        subscriber = Subscriber(bidder_id)
        self._subscribers.add(subscriber)
        try:
            yield subscriber
        finally:
            self._subscribers.discard(subscriber)

    def publish(self, result: BidResult) -> None:
        """Safe to call from any thread, after the bid's transaction has committed."""
        if result.replayed or self._loop is None or self._loop.is_closed():
            return
        self._loop.call_soon_threadsafe(self._fan_out, BidEvent.from_result(result))

    def _fan_out(self, event: BidEvent) -> None:
        for subscriber in list(self._subscribers):
            try:
                subscriber.queue.put_nowait(event)
            except asyncio.QueueFull:
                # A stalled client: end its stream so it reconnects and refetches, rather than
                # letting its backlog grow without bound.
                logger.warning("Dropping slow event subscriber")
                self._subscribers.discard(subscriber)
                subscriber.queue.get_nowait()
                subscriber.queue.put_nowait(None)
