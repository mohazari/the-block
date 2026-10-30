import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { auction, stubApi, vehicleDetail } from '../test/fixtures'
import { FakeEventSource } from '../test/fakeEventSource'
import { renderRoute } from '../test/render'
import { api } from './client'
import { resetSharedStream } from './sharedStream'
import { resetStreamGate } from './streamGate'
import type { FromHub, ToHub } from './streamHub'
import type { AuctionEvent } from './types'

afterEach(() => vi.unstubAllGlobals())

function serveDetail() {
  const api = stubApi((url) =>
    url.pathname === '/api/vehicles/veh-1'
      ? vehicleDetail({ auction: auction({ has_bid: true, is_high_bidder: true }) })
      : url.pathname === '/api/me/bids'
        ? []
        : undefined,
  )
  vi.stubGlobal('fetch', api.fetch)
  return api
}

const rivalBid = (overrides: Partial<AuctionEvent> = {}): AuctionEvent => ({
  type: 'bid',
  vehicle_id: 'veh-1',
  vehicle_title: '2023 Ford Bronco',
  auction: auction({ current_bid: 23300, bid_count: 17, min_next_bid: 23800, has_bid: true }),
  bid: {
    id: 50,
    amount: 23300,
    bidder: 'Bidder 7777',
    is_you: false,
    placed_at: new Date().toISOString(),
  },
  outbid_you: true,
  extended: false,
  ...overrides,
})

const panel = async () => within(await screen.findByRole('complementary', { name: 'Bidding' }))

describe('live auction events', () => {
  it('subscribes once with the bidder id and shows the connection state', async () => {
    serveDetail()
    renderRoute('/vehicles/veh-1')
    await panel()
    const source = FakeEventSource.latest()
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(source.url).toMatch(/^\/api\/events\?bidder_id=[0-9a-f-]+$/)

    act(() =>
      source.emit('hello', {
        server_time: new Date().toISOString(),
        epoch: 'epoch-1',
        run: 'run-1',
      }),
    )
    expect(screen.getByRole('status', { name: 'Live updates: connected' })).toHaveTextContent(
      'Live',
    )
    act(() => source.fail())
    expect(screen.getByRole('status', { name: 'Live updates: reconnecting' })).toHaveTextContent(
      'Reconnecting…',
    )
  })

  it('moves the price in place and warns when you are outbid', async () => {
    serveDetail()
    renderRoute('/vehicles/veh-1')
    const bidding = await panel()
    expect(bidding.getByText("You're the high bidder.")).toBeInTheDocument()

    act(() => FakeEventSource.latest().emit('bid', rivalBid()))

    expect(
      await bidding.findByText(/You've been outbid\. The minimum is now \$23,800\./),
    ).toBeInTheDocument()
    expect(bidding.getByText('17 bids')).toBeInTheDocument()
    expect(bidding.getByText('Bidder 7777')).toBeInTheDocument()
    const toast = screen.getByText("You've been outbid on the 2023 Ford Bronco").closest('div')!
    expect(within(toast.parentElement!).getByRole('link', { name: 'Bid again' })).toHaveAttribute(
      'href',
      '/vehicles/veh-1',
    )
  })

  it('ignores events for vehicles that are not on screen', async () => {
    serveDetail()
    renderRoute('/vehicles/veh-1')
    const bidding = await panel()
    act(() =>
      FakeEventSource.latest().emit('bid', rivalBid({ vehicle_id: 'other', outbid_you: false })),
    )
    expect(bidding.getByText('16 bids')).toBeInTheDocument()
  })

  it('refetches everything after a reconnect, since events may have been missed', async () => {
    const api = serveDetail()
    renderRoute('/vehicles/veh-1')
    await panel()
    const source = FakeEventSource.latest()
    act(() =>
      source.emit('hello', {
        server_time: new Date().toISOString(),
        epoch: 'epoch-1',
        run: 'run-1',
      }),
    )
    const before = api.calls.filter((url) => url.pathname === '/api/vehicles/veh-1').length
    act(() =>
      source.emit('hello', {
        server_time: new Date().toISOString(),
        epoch: 'epoch-1',
        run: 'run-1',
      }),
    )
    await waitFor(() =>
      expect(
        api.calls.filter((url) => url.pathname === '/api/vehicles/veh-1').length,
      ).toBeGreaterThan(before),
    )
  })

  it('reconnects itself when the browser gives up on the stream', async () => {
    serveDetail()
    renderRoute('/vehicles/veh-1')
    await panel()
    vi.useFakeTimers()
    try {
      act(() => FakeEventSource.latest().fail({ fatal: true }))
      expect(FakeEventSource.instances).toHaveLength(1)
      act(() => vi.advanceTimersByTime(3_000))
      expect(FakeEventSource.instances).toHaveLength(2)
      expect(FakeEventSource.instances[0]!.closed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops the cache when the server has reseeded its data', async () => {
    let detail = vehicleDetail({ auction: auction({ bid_count: 16 }) })
    vi.stubGlobal(
      'fetch',
      stubApi((url) =>
        url.pathname === '/api/vehicles/veh-1'
          ? detail
          : url.pathname === '/api/me/bids'
            ? []
            : undefined,
      ).fetch,
    )
    renderRoute('/vehicles/veh-1')
    const bidding = await panel()
    const source = FakeEventSource.latest()
    act(() =>
      source.emit('hello', {
        server_time: new Date().toISOString(),
        epoch: 'epoch-1',
        run: 'run-1',
      }),
    )

    // Reseeded: the same car now has fewer bids, which must not be mistaken for "older" data.
    detail = vehicleDetail({ auction: auction({ bid_count: 3, current_bid: 9000 }) })
    act(() =>
      source.emit('hello', {
        server_time: new Date().toISOString(),
        epoch: 'epoch-2',
        run: 'run-2',
      }),
    )
    expect(await bidding.findByText('3 bids')).toBeInTheDocument()
  })

  it('holds initial reads until the stream is live, then reads once', async () => {
    resetStreamGate()
    const api = serveDetail()
    renderRoute('/vehicles/veh-1')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(api.calls.filter((url) => url.pathname === '/api/vehicles/veh-1')).toHaveLength(0)

    act(() =>
      FakeEventSource.latest().emit('hello', {
        server_time: new Date().toISOString(),
        epoch: 'epoch-1',
        run: 'run-1',
      }),
    )
    await panel()
    await new Promise((resolve) => setTimeout(resolve, 50))
    // Subscribed before reading: nothing could be missed, so no second fetch.
    expect(api.calls.filter((url) => url.pathname === '/api/vehicles/veh-1')).toHaveLength(1)
  })

  it('starts over when a connection goes silent without failing', async () => {
    serveDetail()
    renderRoute('/vehicles/veh-1')
    await panel()
    vi.useFakeTimers()
    try {
      const hello = { server_time: new Date().toISOString(), epoch: 'epoch-1', run: 'run-1' }
      act(() => FakeEventSource.latest().emit('hello', hello))
      act(() => vi.advanceTimersByTime(25_000))
      act(() => FakeEventSource.latest().emit('ping', {})) // quiet, but alive
      act(() => vi.advanceTimersByTime(25_000))
      expect(FakeEventSource.instances).toHaveLength(1)
      act(() => vi.advanceTimersByTime(6_000)) // 31s without even a ping: a dead connection
      expect(FakeEventSource.instances).toHaveLength(2)
      expect(FakeEventSource.instances[0]!.closed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('replaces a stream that stays silent after the tab wakes up', async () => {
    serveDetail()
    renderRoute('/vehicles/veh-1')
    await panel()
    vi.useFakeTimers()
    try {
      const hello = { server_time: new Date().toISOString(), epoch: 'e', run: 'run-1' }
      act(() => FakeEventSource.latest().emit('hello', hello))
      vi.setSystemTime(Date.now() + 600_000) // asleep
      act(() => vi.advanceTimersByTime(30_000)) // overdue timer: grace, not teardown
      expect(FakeEventSource.instances).toHaveLength(1)
      act(() => vi.advanceTimersByTime(5_000)) // nothing arrived during the grace
      expect(FakeEventSource.instances).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reconnects when a response shows its stream is connected to a server that is gone', async () => {
    const stub = stubApi((url) =>
      url.pathname === '/api/vehicles/veh-1'
        ? vehicleDetail()
        : url.pathname === '/api/me/bids'
          ? []
          : undefined,
    )
    vi.stubGlobal('fetch', stub.fetch)
    renderRoute('/vehicles/veh-1')
    await panel()
    const hello = { server_time: new Date().toISOString(), epoch: 'e', run: 'run-1' }
    act(() => FakeEventSource.latest().emit('hello', hello))
    // From here on another server (run-2) answers, a fresh response per request.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{"items": []}', {
            headers: { 'X-Server-Run': 'run-2', 'X-Data-Epoch': 'e' },
          }),
      ),
    )
    await act(() => api('/vehicles'))
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(FakeEventSource.instances[0]!.closed).toBe(true)
  })

  it('ignores an announced heartbeat that is not a positive number', async () => {
    serveDetail()
    renderRoute('/vehicles/veh-1')
    await panel()
    vi.useFakeTimers()
    try {
      const hello = { server_time: new Date().toISOString(), epoch: 'e', run: 'run-1' }
      act(() => FakeEventSource.latest().emit('hello', { ...hello, heartbeat_seconds: 'x' }))
      act(() => vi.advanceTimersByTime(25_000)) // still the default 3 x 10s
      expect(FakeEventSource.instances).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('sizes its watchdog from the heartbeat the server announces', async () => {
    serveDetail()
    renderRoute('/vehicles/veh-1')
    await panel()
    vi.useFakeTimers()
    try {
      const hello = { server_time: new Date().toISOString(), epoch: 'e', run: 'run-1' }
      act(() => FakeEventSource.latest().emit('hello', { ...hello, heartbeat_seconds: 30 }))
      act(() => vi.advanceTimersByTime(80_000)) // under 3 x 30s: still trusted
      expect(FakeEventSource.instances).toHaveLength(1)
      act(() => vi.advanceTimersByTime(11_000))
      expect(FakeEventSource.instances).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives a stream a moment after the tab wakes up instead of reconnecting at once', async () => {
    serveDetail()
    renderRoute('/vehicles/veh-1')
    await panel()
    vi.useFakeTimers()
    try {
      const hello = { server_time: new Date().toISOString(), epoch: 'e', run: 'run-1' }
      act(() => FakeEventSource.latest().emit('hello', hello))
      // Asleep for 10 minutes: the clock jumps, then the overdue timer fires.
      vi.setSystemTime(Date.now() + 600_000)
      act(() => vi.advanceTimersByTime(30_000))
      expect(FakeEventSource.instances).toHaveLength(1) // not torn down on waking
      act(() => FakeEventSource.latest().emit('ping', {})) // buffered ping arrives: alive
      act(() => vi.advanceTimersByTime(10_000))
      expect(FakeEventSource.instances).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not stall the page when the stream never connects', async () => {
    resetStreamGate()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      serveDetail()
      renderRoute('/vehicles/veh-1')
      act(() => vi.advanceTimersByTime(1500))
      expect(await screen.findByRole('complementary', { name: 'Bidding' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('refetches once, not twice, when a reconnect brings a new epoch', async () => {
    const api = serveDetail()
    renderRoute('/vehicles/veh-1')
    await panel()
    const source = FakeEventSource.latest()
    act(() =>
      source.emit('hello', {
        server_time: new Date().toISOString(),
        epoch: 'epoch-1',
        run: 'run-1',
      }),
    )
    await waitFor(() =>
      expect(api.calls.filter((u) => u.pathname === '/api/vehicles/veh-1').length).toBe(2),
    )

    act(() =>
      source.emit('hello', {
        server_time: new Date().toISOString(),
        epoch: 'epoch-2',
        run: 'run-2',
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(api.calls.filter((u) => u.pathname === '/api/vehicles/veh-1')).toHaveLength(3)
  })

  it('shows a bid that landed while the first read was in flight, without re-reading', async () => {
    let calls = 0
    let answerFirstRead!: () => void
    vi.stubGlobal('fetch', (input: string) => {
      const url = new URL(input, 'http://test')
      if (url.pathname !== '/api/vehicles/veh-1') return Promise.resolve(new Response('[]'))
      calls++
      if (calls === 1) {
        // Read before the rival's bid, answered after it.
        const stale = JSON.stringify(vehicleDetail({ auction: auction({ bid_count: 16 }) }))
        return new Promise<Response>(
          (resolve) => (answerFirstRead = () => resolve(new Response(stale))),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify(vehicleDetail({ auction: rivalBid().auction }))),
      )
    })
    renderRoute('/vehicles/veh-1')
    await waitFor(() => expect(calls).toBe(1))

    act(() => FakeEventSource.latest().emit('bid', rivalBid({ outbid_you: false })))
    act(() => answerFirstRead())
    const bidding = await panel()
    expect(await bidding.findByText('17 bids')).toBeInTheDocument()
    expect(bidding.getByText('Bidder 7777')).toBeInTheDocument()
    expect(calls).toBe(1) // settled on the client: no extra request
  })

  it('never restarts reads because of live bids, so a slow link still finishes loading', async () => {
    let myBidsReads = 0
    vi.stubGlobal('fetch', (input: string) => {
      const url = new URL(input, 'http://test')
      if (url.pathname === '/api/me/bids') {
        myBidsReads++
        return new Promise<Response>(() => {}) // a slow link: still loading
      }
      return Promise.resolve(
        new Response(JSON.stringify(url.pathname === '/api/vehicles/veh-1' ? vehicleDetail() : [])),
      )
    })
    renderRoute('/vehicles/veh-1')
    await panel()
    await waitFor(() => expect(myBidsReads).toBe(1))
    for (let n = 0; n < 5; n++) {
      act(() =>
        FakeEventSource.latest().emit(
          'bid',
          rivalBid({ vehicle_id: `other-${n}`, outbid_you: false }),
        ),
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(myBidsReads).toBe(1)
  })

  it('refreshes My bids for a first bid after a reseed even if the bid id repeats', async () => {
    serveDetail()
    const { queryClient } = renderRoute('/vehicles/veh-1')
    await panel()
    const source = FakeEventSource.latest()
    act(() =>
      source.emit('hello', {
        server_time: new Date().toISOString(),
        epoch: 'epoch-1',
        run: 'run-1',
      }),
    )
    const mine = {
      id: 5,
      amount: 23300,
      bidder: 'Bidder 1',
      is_you: true,
      placed_at: new Date().toISOString(),
    }
    act(() => source.emit('bid', rivalBid({ vehicle_id: 'car-a', bid: mine, outbid_you: false })))

    act(() =>
      source.emit('hello', {
        server_time: new Date().toISOString(),
        epoch: 'epoch-2',
        run: 'run-2',
      }),
    )
    await waitFor(() => expect(queryClient.getQueryState(['me', 'bids'])?.fetchStatus).toBe('idle'))
    const spy = vi.spyOn(queryClient, 'cancelQueries')
    act(() => source.emit('bid', rivalBid({ vehicle_id: 'car-b', bid: mine, outbid_you: false })))
    expect(spy).toHaveBeenCalledWith({ queryKey: ['me', 'bids'] })
  })
})

describe('live events over the stream shared between tabs', () => {
  /** The worker's end of the tab's port. */
  let sent: ToHub[]
  let reply: (message: FromHub) => void

  beforeEach(() => {
    resetSharedStream()
    sent = []
    const port = {
      onmessage: null as ((event: MessageEvent<FromHub>) => void) | null,
      postMessage: (message: ToHub) => sent.push(message),
      start() {},
      close() {},
    }
    reply = (message) => port.onmessage?.(new MessageEvent('message', { data: message }))
    vi.stubGlobal('SharedWorker', function SharedWorker() {
      return { port, onerror: null }
    })
  })
  afterEach(() => resetSharedStream())

  const lastOpen = () =>
    sent.filter((m) => m.type === 'open').at(-1) as Extract<ToHub, { type: 'open' }>
  const hello = (run: string) =>
    reply({
      type: 'event',
      id: lastOpen().id,
      name: 'hello',
      data: JSON.stringify({ server_time: new Date().toISOString(), epoch: 'e', run }),
    })

  it('joins the shared stream, and asks for a fresh one with its run when it goes quiet', async () => {
    serveDetail()
    renderRoute('/vehicles/veh-1')
    await panel()
    expect(sent[0]).toMatchObject({ type: 'open', fresh: false })
    expect(FakeEventSource.instances).toHaveLength(0) // no stream of its own
    vi.useFakeTimers()
    try {
      act(() => hello('run-1')) // its watchdog starts on the fake clock
      act(() => vi.advanceTimersByTime(31_000)) // 3 heartbeats of silence
    } finally {
      vi.useRealTimers()
    }
    await act(() => Promise.resolve()) // the old stream's goodbye would go out now
    expect(lastOpen()).toMatchObject({ fresh: 'quiet', run: 'run-1' })
    // A reconnect takes the old stream's place: no goodbye that would close the only tab's stream.
    expect(sent.map((m) => m.type)).toEqual(['open', 'open'])
  })

  it('reports a stale stream with the run it moved to', async () => {
    serveDetail()
    renderRoute('/vehicles/veh-1')
    await panel()
    act(() => hello('run-1'))
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{"items": []}', {
            headers: { 'X-Server-Run': 'run-2', 'X-Data-Epoch': 'e' },
          }),
      ),
    )
    await act(() => api('/vehicles'))
    expect(lastOpen()).toMatchObject({ fresh: 'stale', run: 'run-2' })
  })
})
