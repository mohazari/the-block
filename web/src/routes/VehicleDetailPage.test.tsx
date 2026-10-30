import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VehicleDetail } from '../api/types'
import { auction, stubApi, vehicleDetail } from '../test/fixtures'
import { queryKeys } from '../api/queries'
import { renderRoute } from '../test/render'

afterEach(() => vi.unstubAllGlobals())

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Serve one vehicle; bids go through `onBid`, which returns the response. */
function serve(
  detail: VehicleDetail,
  onBid?: (body: { amount: number }, key: string | null) => Response,
) {
  const api = stubApi((url, init) => {
    if (url.pathname === `/api/vehicles/${detail.id}`) return detail
    if (url.pathname.endsWith('/bids') && onBid) {
      const headers = init?.headers as Record<string, string>
      return onBid(JSON.parse(String(init?.body)), headers['Idempotency-Key'] ?? null)
    }
    if (url.pathname.endsWith('/buy-now')) {
      return json(201, {
        bid: {
          id: 99,
          amount: 30000,
          bidder: 'Bidder 1',
          is_you: true,
          placed_at: new Date().toISOString(),
        },
        auction: auction({
          status: 'ended',
          ends_at: new Date().toISOString(),
          outcome: 'sold',
          is_high_bidder: true,
          has_bid: true,
          current_bid: 30000,
        }),
        extended: false,
      })
    }
    return undefined
  })
  vi.stubGlobal('fetch', api.fetch)
  return api
}

// The bid panel renders twice (phone layout + desktop rail); act on the desktop rail.
const panel = async () => within(await screen.findByRole('complementary', { name: 'Bidding' }))

describe('VehicleDetailPage', () => {
  it('leads with trust signals: branded title, light, and damage worst-first', async () => {
    serve(vehicleDetail({ title_status: 'salvage', worst_damage: 'major' }))
    renderRoute('/vehicles/veh-1')
    expect(await screen.findByRole('heading', { name: '2023 Ford Bronco' })).toBeInTheDocument()
    expect(screen.getByText('Salvage title.')).toBeInTheDocument()
    expect(screen.getAllByText('Red light')[0]).toBeInTheDocument()
    const groups = screen
      .getAllByText(/^(Major|Mechanical|Cosmetic) \(\d\)$/)
      .map((el) => el.textContent)
    expect(groups).toEqual(['Major (1)', 'Mechanical (1)', 'Cosmetic (1)'])
    expect(screen.getByRole('meter', { name: 'Condition grade' })).toHaveAttribute(
      'aria-valuenow',
      '3.8',
    )
  })

  it('places a bid in two steps with one idempotency key per attempt', async () => {
    const keys: (string | null)[] = []
    serve(vehicleDetail(), ({ amount }, key) => {
      keys.push(key)
      return json(201, {
        bid: {
          id: 8,
          amount,
          bidder: 'Bidder 1',
          is_you: true,
          placed_at: new Date().toISOString(),
        },
        auction: auction({
          current_bid: amount,
          bid_count: 17,
          min_next_bid: amount + 500,
          is_high_bidder: true,
          has_bid: true,
        }),
        extended: false,
      })
    })
    renderRoute('/vehicles/veh-1')
    const bidding = await panel()

    await userEvent.click(bidding.getByRole('button', { name: 'Place bid $23,300' }))
    expect(keys).toHaveLength(0) // first click only arms the confirmation
    await userEvent.click(bidding.getByRole('button', { name: 'Confirm $23,300 bid' }))

    expect(await bidding.findByText("You're the high bidder.")).toBeInTheDocument()
    expect(bidding.getByText('17 bids')).toBeInTheDocument()
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatch(/[0-9a-f-]{8,}/)
  })

  it('recovers in place when someone bids first', async () => {
    serve(vehicleDetail(), () =>
      json(409, {
        error: {
          code: 'bid_too_low',
          message: 'The minimum bid is now $23,800.',
          auction: auction({ current_bid: 23300, min_next_bid: 23800 }),
        },
      }),
    )
    renderRoute('/vehicles/veh-1')
    const bidding = await panel()
    await userEvent.click(bidding.getByRole('button', { name: 'Place bid $23,300' }))
    await userEvent.click(bidding.getByRole('button', { name: 'Confirm $23,300 bid' }))

    expect(await bidding.findByRole('alert')).toHaveTextContent(
      'Someone bid first. The minimum bid is now $23,800.',
    )
    // The draft follows the new minimum, ready for another try.
    expect(bidding.getByRole('button', { name: 'Place bid $23,800' })).toBeEnabled()
  })

  it('validates a typed amount before it can be sent', async () => {
    serve(vehicleDetail())
    renderRoute('/vehicles/veh-1')
    const bidding = await panel()
    const input = bidding.getByLabelText('Or enter an amount')
    await userEvent.clear(input)
    await userEvent.type(input, '20000')
    expect(bidding.getByText('The minimum bid is $23,300.')).toBeInTheDocument()
    expect(bidding.getByRole('button', { name: 'Place bid' })).toBeDisabled()
  })

  it('shows a calm leading state instead of the form when you are winning', async () => {
    serve(
      vehicleDetail({
        auction: auction({ is_high_bidder: true, has_bid: true, reserve_status: 'met' }),
      }),
    )
    renderRoute('/vehicles/veh-1')
    const bidding = await panel()
    expect(bidding.getByText(/You lead at \$22,800/)).toBeInTheDocument()
    expect(bidding.queryByRole('button', { name: /Place bid/ })).not.toBeInTheDocument()
  })

  it('buys now after a confirmation', async () => {
    serve(vehicleDetail({ auction: auction({ buy_now_available: true, buy_now_price: 30000 }) }))
    renderRoute('/vehicles/veh-1')
    const bidding = await panel()
    await userEvent.click(bidding.getByRole('button', { name: 'Buy now for $30,000' }))
    await userEvent.click(bidding.getByRole('button', { name: 'Confirm Buy Now for $30,000' }))
    expect(await bidding.findByText('You won this vehicle.')).toBeInTheDocument()
    expect(bidding.getByText('Auction ended')).toBeInTheDocument()
  })

  it('has no bid form once the auction has ended', async () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    serve(vehicleDetail({ auction: auction({ ends_at: past, outcome: 'sold' }) }))
    renderRoute('/vehicles/veh-1')
    const bidding = await panel()
    expect(bidding.getByText('Auction ended')).toBeInTheDocument()
    expect(bidding.queryByRole('button', { name: /Place bid/ })).not.toBeInTheDocument()
  })

  it('explains a vehicle that does not exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json(404, { error: { code: 'vehicle_not_found', message: 'No vehicle with that id.' } }),
        ),
    )
    renderRoute('/vehicles/nope')
    expect(
      await screen.findByRole('heading', { name: 'This vehicle isn’t in the inventory' }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Back to the inventory' })).toHaveAttribute(
        'href',
        '/',
      ),
    )
  })

  it('keeps the confirmed amount pinned when the minimum moves underneath it', async () => {
    serve(vehicleDetail())
    const { queryClient } = renderRoute('/vehicles/veh-1')
    const bidding = await panel()
    await userEvent.click(bidding.getByRole('button', { name: 'Place bid $23,300' }))

    // A rival's bid lands while the buyer is about to confirm.
    queryClient.setQueryData<VehicleDetail>(
      queryKeys.vehicle('veh-1'),
      (detail) =>
        detail && {
          ...detail,
          auction: { ...detail.auction, bid_count: 17, current_bid: 23300, min_next_bid: 23800 },
        },
    )
    expect(await bidding.findByText('The minimum bid is $23,800.')).toBeInTheDocument()
    expect(bidding.getByRole('button', { name: 'Confirm $23,300 bid' })).toBeDisabled()
  })

  it('tells the high bidder the reserve was missed when the clock runs out', async () => {
    const past = new Date(Date.now() - 1000).toISOString()
    serve(
      vehicleDetail({
        auction: auction({
          ends_at: past,
          outcome: null,
          reserve_status: 'not_met',
          is_high_bidder: true,
          has_bid: true,
        }),
      }),
    )
    renderRoute('/vehicles/veh-1')
    const bidding = await panel()
    expect(
      bidding.getByText("You were the high bidder, but the reserve wasn't met."),
    ).toBeInTheDocument()
  })

  it('renders a single bid panel and no Bid shortcut once ended', async () => {
    const past = new Date(Date.now() - 1000).toISOString()
    serve(vehicleDetail({ auction: auction({ ends_at: past, outcome: 'sold' }) }))
    renderRoute('/vehicles/veh-1')
    await panel()
    expect(screen.getAllByRole('complementary', { name: 'Bidding' })).toHaveLength(1)
    expect(screen.queryByRole('link', { name: 'Bid' })).not.toBeInTheDocument()
  })

  it('lets a leader below the reserve raise their bid', async () => {
    serve(
      vehicleDetail({
        auction: auction({ is_high_bidder: true, has_bid: true, reserve_status: 'not_met' }),
      }),
    )
    renderRoute('/vehicles/veh-1')
    const bidding = await panel()
    expect(bidding.getByText(/the reserve isn't met yet/)).toBeInTheDocument()
    expect(bidding.getByRole('button', { name: 'Place bid $23,300' })).toBeEnabled()
  })

  it('does not claim another buyer won when the reserve was missed', async () => {
    const past = new Date(Date.now() - 1000).toISOString()
    serve(
      vehicleDetail({
        auction: auction({ ends_at: past, outcome: 'reserve_not_met', has_bid: true }),
      }),
    )
    renderRoute('/vehicles/veh-1')
    const bidding = await panel()
    expect(
      bidding.getByText("The reserve wasn't met, so this vehicle didn't sell."),
    ).toBeInTheDocument()
    expect(bidding.queryByText('Another buyer won this vehicle.')).not.toBeInTheDocument()
  })

  it('describes soft close the way the server applies it', async () => {
    serve(vehicleDetail())
    renderRoute('/vehicles/veh-1')
    const bidding = await panel()
    expect(bidding.getByText(/resets the clock to 2 minutes/)).toBeInTheDocument()
  })
})
