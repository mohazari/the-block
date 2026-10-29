import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../app/queryClient'
import { applyAuction } from './bidding'
import { auction, vehicle, vehicleDetail, vehicleList } from '../test/fixtures'
import { keepNewerAuctions, queryKeys, useWatch } from './queries'
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

describe('useWatch', () => {
  it('reverts only the watch flag on failure, keeping live prices that arrived meanwhile', async () => {
    const queryClient = createQueryClient()
    const key = queryKeys.vehicle('veh-1')
    queryClient.setQueryData(key, vehicleDetail({ auction: auction({ bid_count: 16 }) }))
    let fail!: () => void
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>(
            (_resolve, reject) => (fail = () => reject(new TypeError('offline'))),
          ),
      ),
    )
    const { result } = renderHook(() => useWatch(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    })

    act(() => result.current.mutate({ vehicleId: 'veh-1', watching: true }))
    await waitFor(() => expect(queryClient.getQueryData<VehicleDetail>(key)?.watching).toBe(true))
    // A live bid lands while the watch request is still in flight.
    applyAuction(queryClient, 'veh-1', auction({ bid_count: 17, current_bid: 23300 }))
    act(() => fail())

    await waitFor(() => expect(queryClient.getQueryData<VehicleDetail>(key)?.watching).toBe(false))
    expect(queryClient.getQueryData<VehicleDetail>(key)?.auction.current_bid).toBe(23300)
    vi.unstubAllGlobals()
  })

  it('sends quick toggles one after another, in click order', async () => {
    const queryClient = createQueryClient()
    const started: string[] = []
    const finish: (() => void)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        started.push(init.method!)
        return new Promise<Response>((resolve) =>
          finish.push(() => resolve(new Response(null, { status: 204 }))),
        )
      }),
    )
    const { result } = renderHook(() => useWatch(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    })

    act(() => {
      result.current.mutate({ vehicleId: 'veh-1', watching: true })
      result.current.mutate({ vehicleId: 'veh-1', watching: false })
    })
    await waitFor(() => expect(started).toEqual(['PUT']))
    act(() => finish[0]!())
    await waitFor(() => expect(started).toEqual(['PUT', 'DELETE']))
    vi.unstubAllGlobals()
  })

  it('revalidates once, after the last of several quick toggles', async () => {
    const queryClient = createQueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const finish: (() => void)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) =>
            finish.push(() => resolve(new Response(null, { status: 204 }))),
          ),
      ),
    )
    const { result } = renderHook(() => useWatch(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    })

    act(() => {
      result.current.mutate({ vehicleId: 'veh-1', watching: true })
      result.current.mutate({ vehicleId: 'veh-1', watching: false })
    })
    await waitFor(() => expect(finish).toHaveLength(1))
    act(() => finish[0]!())
    await waitFor(() => expect(finish).toHaveLength(2))
    expect(invalidate).not.toHaveBeenCalled() // the second toggle is still pending
    act(() => finish[1]!())
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))
    vi.unstubAllGlobals()
  })

  it('reverts a failed toggle even while a toggle on another car is queued', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(queryKeys.vehicle('a'), vehicleDetail({ id: 'a' }))
    queryClient.setQueryData(queryKeys.vehicle('b'), vehicleDetail({ id: 'b' }))
    const settle: ((ok: boolean) => void)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve, reject) =>
            settle.push((ok) =>
              ok ? resolve(new Response(null, { status: 204 })) : reject(new TypeError('offline')),
            ),
          ),
      ),
    )
    const { result } = renderHook(() => useWatch(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    })

    act(() => {
      result.current.mutate({ vehicleId: 'a', watching: true })
      result.current.mutate({ vehicleId: 'b', watching: true })
    })
    await waitFor(() => expect(settle).toHaveLength(1))
    act(() => settle[0]!(false)) // starring car A fails while car B is queued

    await waitFor(() =>
      expect(queryClient.getQueryData<VehicleDetail>(queryKeys.vehicle('a'))?.watching).toBe(false),
    )
    expect(queryClient.getQueryData<VehicleDetail>(queryKeys.vehicle('b'))?.watching).toBe(true)
    vi.unstubAllGlobals()
  })
})
