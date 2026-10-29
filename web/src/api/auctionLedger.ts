import type { AuctionSnapshot, BidOut, MyBid, VehicleDetail, VehicleSummary } from './types'

/**
 * The newest auction state seen for each vehicle — from bid responses, rejections and live
 * events — with the bids seen alongside it. Every read is merged against it, so a read answered
 * before a bid landed (an initial load racing a live event, a slow refetch) can never put an
 * older price or bid history on screen. No extra requests: the race is settled on the client.
 */
interface Seen {
  auction: AuctionSnapshot
  bids: BidOut[]
  /** Your own highest bid seen on this vehicle, for My bids rows. */
  mine?: BidOut
}

const seen = new Map<string, Seen>()
const BIDS_KEPT = 20

export function noteSeen(vehicleId: string, auction: AuctionSnapshot, bid?: BidOut): void {
  const previous = seen.get(vehicleId)
  const newest =
    previous && previous.auction.bid_count > auction.bid_count ? previous.auction : auction
  const bids = previous?.bids ?? []
  const withBid = bid && !bids.some((known) => known.id === bid.id) ? [...bids, bid] : bids
  const mine =
    bid?.is_you && (!previous?.mine || bid.amount > previous.mine.amount) ? bid : previous?.mine
  seen.set(vehicleId, { auction: newest, bids: withBid.slice(-BIDS_KEPT), mine })
}

/** `fresh`, brought up to the newest auction and bids seen for it (`fresh` itself if current). */
export function withNewestSeen<T extends VehicleSummary>(fresh: T): T {
  const known = seen.get(fresh.id)
  if (!known) return fresh
  let result = fresh
  if (known.auction.bid_count > fresh.auction.bid_count) {
    result = { ...result, auction: known.auction }
  }
  if ('recent_bids' in result) {
    const detail = result as T & VehicleDetail
    const recentBids = known.bids.reduce(
      (list, bid) => mergeBid(list, bid, detail.recent_bids_limit),
      detail.recent_bids,
    )
    if (recentBids !== detail.recent_bids) result = { ...result, recent_bids: recentBids }
  }
  if (known.mine && 'my_top_bid' in result) {
    const row = result as T & MyBid
    if (known.mine.amount > row.my_top_bid) {
      result = { ...result, my_top_bid: known.mine.amount, my_last_bid_at: known.mine.placed_at }
    }
  }
  return result
}

/**
 * Add a bid to a history in time order. Bids can arrive out of order (a rival's live event
 * before the response to your own), so position comes from when it was placed, not arrival.
 * Returns the same array when the bid is already there.
 */
export function mergeBid(bids: BidOut[], bid: BidOut, limit: number): BidOut[] {
  if (bids.some((existing) => existing.id === bid.id)) return bids
  return [bid, ...bids]
    .sort((a, b) => Date.parse(b.placed_at) - Date.parse(a.placed_at) || b.id - a.id)
    .slice(0, limit) // the server's limit, so a refetch shows the same list
}

/** Forget everything: after a reseed bid counts and ids restart (and between tests). */
export function forgetSeen(): void {
  seen.clear()
}
