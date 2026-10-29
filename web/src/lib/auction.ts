import type { AuctionSnapshot, AuctionStatus, Standing } from '../api/types'

export const RESERVE_TEXT = {
  met: 'Reserve met',
  not_met: 'Reserve not met',
  no_reserve: 'No reserve',
} as const

/** Under this, a live countdown turns amber. */
export const ENDING_SOON_MS = 15 * 60_000

/**
 * Status from timestamps against the server-corrected clock, so a countdown flips to "ended" at
 * zero without waiting for a refetch. Mirrors the server's rule.
 */
export function statusAt(
  auction: Pick<AuctionSnapshot, 'starts_at' | 'ends_at'>,
  now: number,
): AuctionStatus {
  if (now < Date.parse(auction.starts_at)) return 'upcoming'
  if (now < Date.parse(auction.ends_at)) return 'live'
  return 'ended'
}

/**
 * The viewer's position, in the API's vocabulary (the same rule as GET /api/me/bids), but derived
 * locally so it flips the moment the clock runs out. Right at that moment the cached snapshot has
 * no `outcome` yet, so a sale is inferred from the reserve: met or no reserve means sold.
 */
export function standingAt(auction: AuctionSnapshot, status: AuctionStatus): Standing | null {
  if (!auction.has_bid) return null
  if (status !== 'ended') return auction.is_high_bidder ? 'leading' : 'outbid'
  const sold = auction.outcome ? auction.outcome === 'sold' : auction.reserve_status !== 'not_met'
  return auction.is_high_bidder && sold ? 'won' : 'lost'
}
