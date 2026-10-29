import type { AuctionSnapshot, AuctionStatus } from '../api/types'

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

export type Standing = 'winning' | 'outbid' | 'won' | 'lost' | null

/** The viewer's position in this auction, if they've taken part. */
export function standingAt(auction: AuctionSnapshot, status: AuctionStatus): Standing {
  if (!auction.has_bid) return null
  if (status === 'ended') {
    return auction.is_high_bidder && auction.outcome !== 'reserve_not_met' ? 'won' : 'lost'
  }
  return auction.is_high_bidder ? 'winning' : 'outbid'
}
