"""Auction rules.

Everything here is pure: no database, no clock. `now` is always passed in, so each rule is
deterministic and unit-testable, and the same functions serve the API, the bid transaction and
the rival-bidder simulator.
"""

from datetime import datetime, timedelta
from enum import StrEnum

# A bid this close to the end pushes the close out ("soft close"), so rivals always get a chance
# to respond and last-second sniping stops paying off.
SOFT_CLOSE_WINDOW = timedelta(minutes=2)

# Guard against fat-finger bids (an extra zero): a single bid may not jump past this multiple of
# the minimum next bid.
MAX_JUMP_MULTIPLIER = 3

# (price below which the step applies, step). Steps grow with price so bidding stays meaningful
# on a $3k sedan and a $60k truck alike.
_INCREMENT_LADDER: tuple[tuple[int, int], ...] = ((5_000, 100), (15_000, 250), (50_000, 500))
_TOP_INCREMENT = 1_000


class AuctionStatus(StrEnum):
    UPCOMING = "upcoming"  # listed; accepts pre-bids until it opens
    LIVE = "live"
    ENDED = "ended"


class ReserveStatus(StrEnum):
    NO_RESERVE = "no_reserve"
    NOT_MET = "not_met"
    MET = "met"


class AuctionOutcome(StrEnum):
    SOLD = "sold"
    RESERVE_NOT_MET = "reserve_not_met"
    NO_BIDS = "no_bids"


class BidRejection(StrEnum):
    AUCTION_ENDED = "auction_ended"
    BID_TOO_LOW = "bid_too_low"
    BID_TOO_HIGH = "bid_too_high"
    ALREADY_HIGH_BIDDER = "already_high_bidder"
    USE_BUY_NOW = "use_buy_now"


def bid_increment(price: int) -> int:
    for ceiling, step in _INCREMENT_LADDER:
        if price < ceiling:
            return step
    return _TOP_INCREMENT


def min_next_bid(starting_bid: int, current_bid: int | None) -> int:
    if current_bid is None:
        return starting_bid
    return current_bid + bid_increment(current_bid)


def max_allowed_bid(minimum: int) -> int:
    return minimum * MAX_JUMP_MULTIPLIER


def auction_status(starts_at: datetime, ends_at: datetime, now: datetime) -> AuctionStatus:
    if now < starts_at:
        return AuctionStatus.UPCOMING
    if now < ends_at:
        return AuctionStatus.LIVE
    return AuctionStatus.ENDED


def reserve_status(reserve_price: int | None, current_bid: int | None) -> ReserveStatus:
    """Buyers see whether the reserve is met — never the reserve amount itself."""
    if reserve_price is None:
        return ReserveStatus.NO_RESERVE
    if current_bid is not None and current_bid >= reserve_price:
        return ReserveStatus.MET
    return ReserveStatus.NOT_MET


def auction_outcome(reserve_price: int | None, current_bid: int | None) -> AuctionOutcome:
    if current_bid is None:
        return AuctionOutcome.NO_BIDS
    if reserve_status(reserve_price, current_bid) is ReserveStatus.NOT_MET:
        return AuctionOutcome.RESERVE_NOT_MET
    return AuctionOutcome.SOLD


def buy_now_available(
    status: AuctionStatus, buy_now_price: int | None, current_bid: int | None
) -> bool:
    if buy_now_price is None or status is AuctionStatus.ENDED:
        return False
    return current_bid is None or current_bid < buy_now_price


def extended_close(ends_at: datetime, bid_at: datetime) -> datetime:
    """Soft close: a bid inside the final window re-arms the window from the bid time."""
    if ends_at - bid_at < SOFT_CLOSE_WINDOW:
        return bid_at + SOFT_CLOSE_WINDOW
    return ends_at


def validate_bid(
    *,
    amount: int,
    status: AuctionStatus,
    minimum: int,
    bidder_id: str,
    high_bidder_id: str | None,
    available_buy_now: int | None = None,
) -> BidRejection | None:
    """Return why a bid must be rejected, or None if it is acceptable.

    `available_buy_now` is the Buy Now price while Buy Now is still offered, else None.

    Upcoming auctions accept pre-bids: the dataset already has bids on auctions that have not
    opened, which is how wholesale lanes work (proxy bids placed before the car runs).
    """
    if status is AuctionStatus.ENDED:
        return BidRejection.AUCTION_ENDED
    # Raising your own winning bid only costs you money, so it is blocked rather than silently
    # accepted.
    if high_bidder_id is not None and high_bidder_id == bidder_id:
        return BidRejection.ALREADY_HIGH_BIDDER
    if amount < minimum:
        return BidRejection.BID_TOO_LOW
    if amount > max_allowed_bid(minimum):
        return BidRejection.BID_TOO_HIGH
    # Bidding at or above the Buy Now price only leads the auction; the buyer should just buy it.
    if available_buy_now is not None and amount >= available_buy_now:
        return BidRejection.USE_BUY_NOW
    return None
