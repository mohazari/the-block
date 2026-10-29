import { describe, expect, it } from 'vitest'
import { auction, vehicle, vehicleDetail } from '../test/fixtures'
import { noteSeen, withNewestSeen } from './auctionLedger'

const rival = {
  id: 50,
  amount: 23300,
  bidder: 'Bidder 2',
  is_you: false,
  placed_at: new Date(Date.now() + 60_000).toISOString(), // after the fixture's "now" bid
}

describe('auction ledger', () => {
  it('brings a read answered before a live bid up to date', () => {
    noteSeen('veh-1', auction({ bid_count: 17, current_bid: 23300 }), rival)
    const stale = vehicleDetail({ auction: auction({ bid_count: 16, current_bid: 22800 }) })
    const merged = withNewestSeen(stale)
    expect(merged.auction.current_bid).toBe(23300)
    expect(merged.recent_bids[0]).toEqual(rival)
  })

  it('leaves newer reads alone and returns the same object when nothing changes', () => {
    noteSeen('veh-1', auction({ bid_count: 17 }))
    const newer = vehicle({ auction: auction({ bid_count: 18 }) })
    expect(withNewestSeen(newer)).toBe(newer)
  })

  it('never moves backwards', () => {
    noteSeen('veh-1', auction({ bid_count: 18, current_bid: 24000 }))
    noteSeen('veh-1', auction({ bid_count: 17, current_bid: 23300 })) // late, older
    expect(
      withNewestSeen(vehicle({ auction: auction({ bid_count: 1 }) })).auction.current_bid,
    ).toBe(24000)
  })

  it('keeps your newest top bid on a My bids row read before it', () => {
    const mine = { ...rival, id: 51, amount: 21000, is_you: true }
    noteSeen('veh-1', auction({ bid_count: 17 }), mine)
    const staleRow = {
      ...vehicle({ auction: auction({ bid_count: 16 }) }),
      my_top_bid: 20000,
      my_last_bid_at: '2026-10-28T12:00:00Z',
      standing: 'leading' as const,
    }
    const merged = withNewestSeen(staleRow)
    expect(merged.my_top_bid).toBe(21000)
    expect(merged.my_last_bid_at).toBe(mine.placed_at)
  })
})
