import { describe, expect, it } from 'vitest'
import { createQueryClient } from '../app/queryClient'
import { auction, vehicleDetail } from '../test/fixtures'
import { applyAuction } from './bidding'
import { queryKeys } from './queries'
import type { VehicleDetail } from './types'

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
})
