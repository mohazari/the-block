"""Bidder identity without accounts.

The browser generates an anonymous bidder id. Other buyers never see it: bids are labelled per
vehicle ("Bidder 3", see services.inventory.bidder_labels).
"""

# The competing dealers: used for the seeded bid history and by the live rival-bid simulator.
RIVAL_BIDDER_IDS: tuple[str, ...] = tuple(f"rival-{n:02d}" for n in range(1, 13))
