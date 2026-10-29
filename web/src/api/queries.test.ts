import { describe, expect, it } from 'vitest'
import { auction, vehicle, vehicleDetail, vehicleList } from '../test/fixtures'
import { keepNewerAuctions } from './queries'
import type { VehicleDetail, VehicleList } from './types'

describe('keepNewerAuctions', () => {
  it('never lets a refetch roll back a live bid that landed while it was in flight', () => {
    const cached = vehicleList([
      vehicle({ auction: auction({ bid_count: 17, current_bid: 23300 }) }),
    ])
    const refetched = vehicleList([
      vehicle({ auction: auction({ bid_count: 16, current_bid: 22800 }) }),
    ])
    const merged = keepNewerAuctions(cached, refetched) as VehicleList
    expect(merged.items[0]!.auction.current_bid).toBe(23300)
  })

  it('takes newer refetched data as usual', () => {
    const cached = vehicleDetail({ auction: auction({ bid_count: 16 }) })
    const refetched = vehicleDetail({ auction: auction({ bid_count: 18, current_bid: 24000 }) })
    expect((keepNewerAuctions(cached, refetched) as VehicleDetail).auction.current_bid).toBe(24000)
  })
})
