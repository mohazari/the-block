import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../app/queryClient'
import { auction, vehicleDetail } from '../test/fixtures'
import { usePlaceBid } from './bidding'
import { noteDataEpoch } from './dataEpoch'
import { queryKeys } from './queries'
import type { VehicleDetail } from './types'

afterEach(() => vi.unstubAllGlobals())

describe('a bid in flight across a data reset', () => {
  it('reports the outcome but keeps its old-data snapshot out of the cache', async () => {
    const queryClient = createQueryClient()
    const key = queryKeys.vehicle('veh-1')
    queryClient.setQueryData(key, vehicleDetail({ auction: auction({ bid_count: 2 }) }))
    noteDataEpoch('old')
    let answer!: (response: Response) => void
    vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => (answer = resolve)))

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => usePlaceBid('veh-1'), { wrapper })
    act(() => result.current.mutate({ amount: 30000, idempotencyKey: 'key-1' }))
    await waitFor(() => expect(answer).toBeDefined())

    noteDataEpoch('new') // reset while the bid is in flight
    const placed = {
      bid: {
        id: 9,
        amount: 30000,
        bidder: 'Bidder 1',
        is_you: true,
        placed_at: '2026-10-29T08:00:00Z',
      },
      auction: auction({ bid_count: 40, current_bid: 30000 }), // from the old data
      extended: false,
    }
    answer(new Response(JSON.stringify(placed), { status: 201 }))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(queryClient.getQueryData<VehicleDetail>(key)?.auction.bid_count).toBe(2)
  })
})
