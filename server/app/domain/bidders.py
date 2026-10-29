"""Bidder identity without accounts.

The browser generates an anonymous bidder id. Other buyers are only ever shown a stable,
non-reversible alias ("Bidder 4821"), so bid history is readable without exposing ids.
"""

import hashlib

# The competing dealers: used for the seeded bid history and by the live rival-bid simulator.
RIVAL_BIDDER_IDS: tuple[str, ...] = tuple(f"rival-{n:02d}" for n in range(1, 13))


def bidder_alias(bidder_id: str) -> str:
    digest = hashlib.sha256(bidder_id.encode()).hexdigest()
    return f"Bidder {int(digest[:8], 16) % 9000 + 1000}"
