import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { auction, stubApi, vehicleDetail } from '../test/fixtures'
import { FakeEventSource } from '../test/fakeEventSource'
import { renderRoute } from '../test/render'
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

    act(() => source.emit('hello', { server_time: new Date().toISOString() }))
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
    act(() => source.emit('hello', { server_time: new Date().toISOString() }))
    const before = api.calls.filter((url) => url.pathname === '/api/vehicles/veh-1').length
    act(() => source.emit('hello', { server_time: new Date().toISOString() }))
    await waitFor(() =>
      expect(
        api.calls.filter((url) => url.pathname === '/api/vehicles/veh-1').length,
      ).toBeGreaterThan(before),
    )
  })
})
