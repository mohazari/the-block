import { describe, expect, it } from 'vitest'
import { createQueryClient } from '../app/queryClient'
import { auction, vehicle, vehicleDetail } from '../test/fixtures'
import { applyAuction } from './bidding'
import { queryKeys } from './queries'
import type { MyBid, VehicleDetail } from './types'

describe('applyAuction', () => {
  it('never lets an older snapshot overwrite a newer one', () => {
    const queryClient = createQueryClient()
    const key = queryKeys.vehicle('veh-1')
    queryClient.setQueryData(
      key,
      vehicleDetail({ auction: auction({ bid_count: 18, current_bid: 10500 }) }),
    )

    // The response to your own earlier bid arrives after a rival's newer bid was applied.
    applyAuction(
      queryClient,
      'veh-1',
      auction({ bid_count: 17, current_bid: 10000, is_high_bidder: true }),
    )
    expect(queryClient.getQueryData<VehicleDetail>(key)?.auction.current_bid).toBe(10500)

    applyAuction(queryClient, 'veh-1', auction({ bid_count: 19, current_bid: 11000 }))
    expect(queryClient.getQueryData<VehicleDetail>(key)?.auction.current_bid).toBe(11000)
  })

  it('keeps bid history in time order when an older bid arrives late', () => {
    const queryClient = createQueryClient()
    const key = queryKeys.vehicle('veh-1')
    const newer = {
      id: 12,
      amount: 24000,
      bidder: 'Bidder 2',
      is_you: false,
      placed_at: '2026-10-28T12:00:05Z',
    }
    queryClient.setQueryData(
      key,
      vehicleDetail({ auction: auction({ bid_count: 12 }), recent_bids: [newer] }),
    )

    const older = {
      id: 11,
      amount: 23500,
      bidder: 'Bidder 1',
      is_you: true,
      placed_at: '2026-10-28T12:00:01Z',
    }
    applyAuction(queryClient, 'veh-1', auction({ bid_count: 11 }), older)

    const bids = queryClient.getQueryData<VehicleDetail>(key)!.recent_bids
    expect(bids.map((b) => b.amount)).toEqual([24000, 23500])
  })

  it("caps the history at the server's limit", () => {
    const queryClient = createQueryClient()
    const key = queryKeys.vehicle('veh-1')
    const old = {
      id: 1,
      amount: 100,
      bidder: 'Bidder 1',
      is_you: false,
      placed_at: '2026-10-28T12:00:00Z',
    }
    queryClient.setQueryData(key, vehicleDetail({ recent_bids: [old], recent_bids_limit: 1 }))
    const latest = { ...old, id: 2, amount: 200, placed_at: '2026-10-28T12:01:00Z' }
    applyAuction(queryClient, 'veh-1', auction({ bid_count: 99 }), latest)
    expect(queryClient.getQueryData<VehicleDetail>(key)!.recent_bids.map((b) => b.id)).toEqual([2])
  })

  it('records your own bid in My bids without refetching it', () => {
    const queryClient = createQueryClient()
    const entry = {
      ...vehicle({ id: 'veh-1' }),
      my_top_bid: 22000,
      my_last_bid_at: '2026-10-28T12:00:00Z',
      standing: 'outbid' as const,
    }
    queryClient.setQueryData(queryKeys.myBids, [entry])
    const mine = {
      id: 9,
      amount: 23300,
      bidder: 'Bidder 1',
      is_you: true,
      placed_at: '2026-10-28T12:05:00Z',
    }

    applyAuction(queryClient, 'veh-1', auction({ bid_count: 17 }), mine)
    applyAuction(queryClient, 'veh-1', auction({ bid_count: 17 }), mine) // the live echo

    const [updated] = queryClient.getQueryData<MyBid[]>(queryKeys.myBids)!
    expect(updated).toMatchObject({ my_top_bid: 23300, my_last_bid_at: '2026-10-28T12:05:00Z' })
    expect(queryClient.getQueryState(queryKeys.myBids)?.isInvalidated).toBe(false)
  })

  it('refetches My bids when your bid is on a car it does not list yet', () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(queryKeys.myBids, [])
    const mine = {
      id: 9,
      amount: 23300,
      bidder: 'Bidder 1',
      is_you: true,
      placed_at: '2026-10-28T12:05:00Z',
    }
    applyAuction(queryClient, 'veh-1', auction({ bid_count: 17 }), mine)
    expect(queryClient.getQueryState(queryKeys.myBids)?.isInvalidated).toBe(true)
  })
})
