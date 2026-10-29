"""Damage-note severity.

The dataset gives damage as free text. A buyer cares most about *what kind* of problem it is: a
scuffed bumper is priced in, a slipping transmission is a repair bill, flood or frame damage
changes whether they bid at all. Notes are classified by keyword, most severe tier first.
"""

from enum import StrEnum


class DamageSeverity(StrEnum):
    COSMETIC = "cosmetic"
    MECHANICAL = "mechanical"
    STRUCTURAL = "structural"


_RANK = {DamageSeverity.COSMETIC: 0, DamageSeverity.MECHANICAL: 1, DamageSeverity.STRUCTURAL: 2}

# Checked in order; the first tier with a matching keyword wins.
_KEYWORDS: tuple[tuple[DamageSeverity, tuple[str, ...]], ...] = (
    (DamageSeverity.STRUCTURAL, ("frame", "flood", "airbag", "water damage")),
    (
        DamageSeverity.MECHANICAL,
        ("transmission", "engine", "brake", "compressor", "catalytic", "electrical", "slips"),
    ),
)


def classify_damage(note: str) -> DamageSeverity:
    text = note.lower()
    for severity, keywords in _KEYWORDS:
        if any(keyword in text for keyword in keywords):
            return severity
    return DamageSeverity.COSMETIC


def worst_severity(notes: list[str]) -> DamageSeverity | None:
    if not notes:
        return None
    return max((classify_damage(note) for note in notes), key=_RANK.__getitem__)
