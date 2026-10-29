import type { AuctionSnapshot } from '../api/types'
import { formatMoney } from './format'

/** Why an amount can't be bid, checked as the buyer types (the server re-checks under lock). */
export function amountProblem(amount: number | null, auction: AuctionSnapshot): string | null {
  if (amount === null || Number.isNaN(amount)) return 'Enter a bid amount.'
  if (!Number.isInteger(amount)) return 'Bids are in whole dollars.'
  if (amount < auction.min_next_bid)
    return `The minimum bid is ${formatMoney(auction.min_next_bid)}.`
  if (amount > auction.max_bid)
    // Worded from max_bid, so it stays true whatever multiple the server allows.
    return `That's above the largest single bid allowed (${formatMoney(auction.max_bid)}). Check the amount.`
  if (
    auction.buy_now_available &&
    auction.buy_now_price !== null &&
    amount >= auction.buy_now_price
  )
    return `That's at or above Buy Now. Buy it now for ${formatMoney(auction.buy_now_price)} instead.`
  return null
}
