from datetime import UTC, datetime, timedelta

import pytest

from app.domain.auction import (
    SOFT_CLOSE_WINDOW,
    AuctionOutcome,
    AuctionStatus,
    BidRejection,
    ReserveStatus,
    auction_outcome,
    auction_status,
    bid_increment,
    buy_now_available,
    extended_close,
    min_next_bid,
    reserve_status,
    validate_bid,
)

T0 = datetime(2026, 10, 28, 12, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    ("price", "step"),
    [(0, 100), (4_999, 100), (5_000, 250), (14_999, 250), (15_000, 500), (49_999, 500),
     (50_000, 1_000), (120_000, 1_000)],
)  # fmt: skip
def test_bid_increment_grows_with_price(price: int, step: int) -> None:
    assert bid_increment(price) == step


def test_min_next_bid_is_starting_bid_when_no_bids() -> None:
    assert min_next_bid(starting_bid=14_500, current_bid=None) == 14_500


def test_min_next_bid_adds_increment_to_current_bid() -> None:
    assert min_next_bid(starting_bid=14_500, current_bid=22_800) == 23_300


def test_auction_status_boundaries() -> None:
    starts, ends = T0, T0 + timedelta(days=4)
    assert auction_status(starts, ends, T0 - timedelta(seconds=1)) is AuctionStatus.UPCOMING
    assert auction_status(starts, ends, T0) is AuctionStatus.LIVE
    assert auction_status(starts, ends, ends - timedelta(seconds=1)) is AuctionStatus.LIVE
    assert auction_status(starts, ends, ends) is AuctionStatus.ENDED


@pytest.mark.parametrize(
    ("reserve", "current", "expected"),
    [
        (None, None, ReserveStatus.NO_RESERVE),
        (None, 9_000, ReserveStatus.NO_RESERVE),
        (25_000, None, ReserveStatus.NOT_MET),
        (25_000, 24_999, ReserveStatus.NOT_MET),
        (25_000, 25_000, ReserveStatus.MET),
    ],
)
def test_reserve_status(reserve: int | None, current: int | None, expected: ReserveStatus) -> None:
    assert reserve_status(reserve, current) is expected


@pytest.mark.parametrize(
    ("reserve", "current", "expected"),
    [
        (25_000, None, AuctionOutcome.NO_BIDS),
        (25_000, 20_000, AuctionOutcome.RESERVE_NOT_MET),
        (25_000, 25_000, AuctionOutcome.SOLD),
        (None, 1_000, AuctionOutcome.SOLD),
    ],
)
def test_auction_outcome(
    reserve: int | None, current: int | None, expected: AuctionOutcome
) -> None:
    assert auction_outcome(reserve, current) is expected


def test_buy_now_available_only_while_open_and_below_price() -> None:
    assert buy_now_available(AuctionStatus.LIVE, 30_000, None)
    assert buy_now_available(AuctionStatus.UPCOMING, 30_000, 20_000)
    assert not buy_now_available(AuctionStatus.LIVE, 30_000, 30_000)
    assert not buy_now_available(AuctionStatus.ENDED, 30_000, None)
    assert not buy_now_available(AuctionStatus.LIVE, None, None)


def test_soft_close_extends_only_inside_the_window() -> None:
    ends = T0 + timedelta(minutes=10)
    assert extended_close(ends, bid_at=T0) == ends
    late_bid = ends - timedelta(seconds=30)
    assert extended_close(ends, bid_at=late_bid) == late_bid + SOFT_CLOSE_WINDOW


def _validate(**overrides: object) -> BidRejection | None:
    params: dict[str, object] = {
        "amount": 23_300,
        "status": AuctionStatus.LIVE,
        "minimum": 23_300,
        "bidder_id": "me",
        "high_bidder_id": "rival-01",
    }
    params.update(overrides)
    return validate_bid(**params)  # type: ignore[arg-type]


def test_valid_bid_at_exact_minimum() -> None:
    assert _validate() is None


def test_bid_below_available_buy_now_is_fine() -> None:
    assert _validate(amount=29_999, available_buy_now=30_000) is None


def test_pre_bids_are_accepted_on_upcoming_auctions() -> None:
    assert _validate(status=AuctionStatus.UPCOMING) is None


@pytest.mark.parametrize(
    ("overrides", "rejection"),
    [
        ({"status": AuctionStatus.ENDED}, BidRejection.AUCTION_ENDED),
        ({"amount": 23_299}, BidRejection.BID_TOO_LOW),
        ({"amount": 23_300 * 3 + 1}, BidRejection.BID_TOO_HIGH),
        ({"high_bidder_id": "me"}, BidRejection.ALREADY_HIGH_BIDDER),
        ({"amount": 30_000, "available_buy_now": 30_000}, BidRejection.USE_BUY_NOW),
    ],
)
def test_bid_rejections(overrides: dict[str, object], rejection: BidRejection) -> None:
    assert _validate(**overrides) is rejection


def test_reaching_the_buy_now_price_meets_the_reserve() -> None:
    # Seller agreed to sell at Buy Now, even if it sits below the reserve.
    assert reserve_status(30_000, 28_000, buy_now_price=28_000) is ReserveStatus.MET
    assert auction_outcome(30_000, 28_000, buy_now_price=28_000) is AuctionOutcome.SOLD
    assert reserve_status(30_000, 27_000, buy_now_price=28_000) is ReserveStatus.NOT_MET
