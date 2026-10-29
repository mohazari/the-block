from datetime import UTC, datetime, timedelta

from app.domain.bidders import bidder_alias
from app.domain.damage import DamageSeverity, classify_damage, worst_severity
from app.domain.schedule import (
    AUCTION_DURATION,
    FIRST_CLOSE_LEAD,
    parse_dataset_time,
    schedule_shift,
)

NOW = datetime(2026, 10, 28, 12, 0, 30, tzinfo=UTC)


def test_dataset_times_are_read_as_utc() -> None:
    assert parse_dataset_time("2026-04-05T14:00:00") == datetime(2026, 4, 5, 14, tzinfo=UTC)


def test_shift_makes_earliest_auction_close_shortly_after_now() -> None:
    starts = [datetime(2026, 4, 1, 9, tzinfo=UTC), datetime(2026, 3, 31, 9, tzinfo=UTC)]
    shift = schedule_shift(starts, NOW)

    first_close = min(starts) + shift + AUCTION_DURATION
    assert abs(first_close - (NOW + FIRST_CLOSE_LEAD)) <= timedelta(seconds=30)
    assert shift % timedelta(minutes=1) == timedelta(0)


def test_shift_preserves_relative_spacing() -> None:
    starts = [datetime(2026, 3, 31, 9, tzinfo=UTC), datetime(2026, 4, 2, 15, tzinfo=UTC)]
    shift = schedule_shift(starts, NOW)
    assert (starts[1] + shift) - (starts[0] + shift) == starts[1] - starts[0]


def test_damage_classification_tiers() -> None:
    assert classify_damage("Minor scratches on front bumper") is DamageSeverity.COSMETIC
    assert classify_damage("Transmission slips between 2nd and 3rd gear") is (
        DamageSeverity.MECHANICAL
    )
    assert classify_damage("Worn brake rotors - due for replacement") is DamageSeverity.MECHANICAL
    # Major wins even when a mechanical keyword is also present.
    assert classify_damage("Flood damage - electrical issues present") is DamageSeverity.MAJOR
    assert classify_damage("Water damage to rear cargo area carpet") is DamageSeverity.MAJOR


def test_damage_keywords_match_whole_phrases_only() -> None:
    assert classify_damage("Scratch on door frame trim") is DamageSeverity.COSMETIC
    assert classify_damage("Engine bay cover cracked") is DamageSeverity.COSMETIC


def test_worst_severity() -> None:
    assert worst_severity([]) is None
    assert worst_severity(["Dent on tailgate", "Check engine light"]) is DamageSeverity.MECHANICAL


def test_bidder_alias_is_stable_and_anonymous() -> None:
    alias = bidder_alias("3f1c-some-browser-id")
    assert alias == bidder_alias("3f1c-some-browser-id")
    assert alias.startswith("Bidder ")
    assert "3f1c" not in alias
