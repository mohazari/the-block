"""Damage-note severity.

The dataset gives damage as free text. A buyer cares most about *what kind* of problem it is: a
scuffed bumper is priced in, a slipping transmission is a repair bill, and frame, flood, airbag or
water-intrusion history changes whether they bid at all. Notes are classified by whole-word
keyword, most severe tier first, and the classifier is tested against every note in the dataset.
"""

import re
from enum import StrEnum


class DamageSeverity(StrEnum):
    COSMETIC = "cosmetic"
    MECHANICAL = "mechanical"
    MAJOR = "major"  # frame / flood / airbag / water intrusion — inspect before bidding


_RANK = {DamageSeverity.COSMETIC: 0, DamageSeverity.MECHANICAL: 1, DamageSeverity.MAJOR: 2}

# Checked in order; the first tier with a matching keyword wins.
_PATTERNS: tuple[tuple[DamageSeverity, re.Pattern[str]], ...] = (
    (DamageSeverity.MAJOR, re.compile(r"\b(frame damage|flood|airbag|water damage)\b", re.I)),
    (
        DamageSeverity.MECHANICAL,
        re.compile(
            r"\b(transmission|check engine|brake|compressor|catalytic|electrical|slips)\b", re.I
        ),
    ),
)


def classify_damage(note: str) -> DamageSeverity:
    for severity, pattern in _PATTERNS:
        if pattern.search(note):
            return severity
    return DamageSeverity.COSMETIC


def worst_severity(notes: list[str]) -> DamageSeverity | None:
    if not notes:
        return None
    return max((classify_damage(note) for note in notes), key=_RANK.__getitem__)
