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
})
