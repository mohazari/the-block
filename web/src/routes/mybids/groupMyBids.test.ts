import { describe, expect, it } from 'vitest'
import type { MyBid } from '../../api/types'
import { auction, vehicle } from '../../test/fixtures'
import { groupMyBids, needsAttention } from './groupMyBids'

const myBid = (id: string, overrides: Parameters<typeof auction>[0]): MyBid => ({
  ...vehicle({ id }),
  auction: auction({ has_bid: true, ...overrides }),
  my_top_bid: 20000,
  my_last_bid_at: new Date().toISOString(),
  standing: 'leading',
})

describe('groupMyBids', () => {
  const now = Date.now()
  const past = new Date(now - 1000).toISOString()
  const bids = [
    myBid('lead', { is_high_bidder: true }),
    myBid('out', {}),
    myBid('done', { ends_at: past, outcome: 'sold', is_high_bidder: true }),
  ]

  it('sorts bids by what needs doing, from the live snapshot', () => {
    const groups = groupMyBids(bids, [vehicle({ id: 'lead' }), vehicle({ id: 'starred' })], now)
    expect(groups.outbid.map((b) => b.id)).toEqual(['out'])
    expect(groups.leading.map((b) => b.id)).toEqual(['lead'])
    expect(groups.finished.map((b) => b.id)).toEqual(['done'])
    // Watched cars you've already bid on appear once, under their bid.
    expect(groups.watching.map((v) => v.id)).toEqual(['starred'])
  })

  it('counts open auctions you have been outbid on', () => {
    expect(needsAttention(bids, now)).toBe(1)
  })
})
