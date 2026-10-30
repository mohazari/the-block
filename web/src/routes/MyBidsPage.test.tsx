import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MyBid, VehicleSummary } from '../api/types'
import { auction, stubApi, vehicle, vehicleDetail, vehicleList } from '../test/fixtures'
import { renderRoute } from '../test/render'

afterEach(() => vi.unstubAllGlobals())

function serve(bids: MyBid[], watched: VehicleSummary[] = []) {
  const api = stubApi((url) =>
    url.pathname === '/api/me/bids'
      ? bids
      : url.pathname === '/api/me/watchlist'
        ? watched
        : undefined,
  )
  vi.stubGlobal('fetch', api.fetch)
  return api
}

const outbid: MyBid = {
  ...vehicle({ id: 'out', model: 'F-150' }),
  auction: auction({ has_bid: true }),
  my_top_bid: 22300,
  my_last_bid_at: new Date().toISOString(),
  standing: 'outbid',
}

describe('MyBidsPage', () => {
  it('puts outbid auctions first, with your top bid and a nav badge', async () => {
    serve([outbid])
    renderRoute('/my-bids')
    const section = (await screen.findByRole('heading', { name: /Outbid/ })).closest('section')!
    const row = within(section).getByRole('article', { name: '2023 Ford F-150' })
    expect(within(row).getByText('Your top bid $22,300')).toBeInTheDocument()
    expect(within(screen.getByRole('link', { name: /My bids/ })).getByText('1')).toBeInTheDocument()
  })

  it("takes 'Back to inventory' on a car opened from here to the inventory, not back here", async () => {
    vi.stubGlobal(
      'fetch',
      stubApi((url) =>
        url.pathname === '/api/me/bids'
          ? [outbid]
          : url.pathname === '/api/me/watchlist'
            ? []
            : url.pathname === '/api/vehicles/out'
              ? vehicleDetail({ id: 'out', model: 'F-150' })
              : url.pathname === '/api/vehicles'
                ? vehicleList([vehicle()])
                : undefined,
      ).fetch,
    )
    renderRoute('/my-bids')
    await userEvent.click(await screen.findByRole('link', { name: '2023 Ford F-150' }))
    await userEvent.click(await screen.findByRole('link', { name: 'Back to inventory' }))
    expect(await screen.findByRole('heading', { name: 'Inventory' })).toBeInTheDocument()
  })

  it('invites you to the inventory when there is nothing to show', async () => {
    serve([])
    renderRoute('/my-bids')
    expect(
      await screen.findByRole('heading', { name: 'No bids or watched vehicles yet' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse the inventory' })).toHaveAttribute('href', '/')
  })

  it('suggests the auctions closing first when there is nothing to show', async () => {
    const api = stubApi((url) =>
      url.pathname === '/api/vehicles'
        ? vehicleList([vehicle({ id: 'soon', model: 'Ranger' })])
        : url.pathname.startsWith('/api/me/')
          ? []
          : undefined,
    )
    vi.stubGlobal('fetch', api.fetch)
    renderRoute('/my-bids')
    const section = (await screen.findByRole('heading', { name: 'Ending soonest' })).closest(
      'section',
    )!
    expect(within(section).getByRole('article', { name: '2023 Ford Ranger' })).toBeInTheDocument()
    const query = api.calls.find((url) => url.pathname === '/api/vehicles')!.searchParams
    expect(query.get('sort')).toBe('ending_soon')
    expect(query.getAll('status')).toEqual(['live'])
  })

  it('loads watched cars from the watchlist endpoint, not the inventory search', async () => {
    const api = serve([], [vehicle({ id: 'starred', model: 'Escape', watching: true })])
    renderRoute('/my-bids')
    const section = (await screen.findByRole('heading', { name: /Watching/ })).closest('section')!
    expect(within(section).getByRole('article', { name: '2023 Ford Escape' })).toBeInTheDocument()
    expect(api.calls.some((url) => url.pathname === '/api/vehicles')).toBe(false)
  })
})
