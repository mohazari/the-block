import type { MyBid, VehicleSummary } from '../../api/types'
import { standingAt, statusAt } from '../../lib/auction'

export interface MyBidGroups {
  outbid: MyBid[]
  leading: MyBid[]
  finished: MyBid[]
  watching: VehicleSummary[]
}

/**
 * Sorted by what needs doing: auctions you're losing first, then ones you lead, then finished.
 * Standing is derived from the live snapshot (not the list's server-computed field) so a group
 * changes the moment a live bid lands or a clock runs out.
 */
export function groupMyBids(bids: MyBid[], watched: VehicleSummary[], now: number): MyBidGroups {
  const groups: MyBidGroups = { outbid: [], leading: [], finished: [], watching: [] }
  for (const bid of bids) {
    const standing = standingAt(bid.auction, statusAt(bid.auction, now))
    if (standing === 'outbid') groups.outbid.push(bid)
    else if (standing === 'leading') groups.leading.push(bid)
    else groups.finished.push(bid)
  }
  const bidOn = new Set(bids.map((bid) => bid.id))
  groups.watching = watched.filter((vehicle) => !bidOn.has(vehicle.id))
  return groups
}

/** Open auctions where the buyer has been outbid: the number on the nav badge. */
export const needsAttention = (bids: MyBid[], now: number): number =>
  groupMyBids(bids, [], now).outbid.length
