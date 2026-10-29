import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { auction, stubApi, vehicle, vehicleList } from '../test/fixtures'
import { renderRoute } from '../test/render'

afterEach(() => vi.unstubAllGlobals())

function serve(list = vehicleList([vehicle()])) {
  const api = stubApi((url) => (url.pathname === '/api/vehicles' ? list : undefined))
  vi.stubGlobal('fetch', api.fetch)
  return api
}

describe('InventoryPage', () => {
  it('lists vehicles with price, condition light and time left', async () => {
    serve()
    renderRoute('/')
    const row = await screen.findByRole('article', { name: '2023 Ford Bronco' })
    expect(within(row).getByRole('link', { name: '2023 Ford Bronco' })).toHaveAttribute(
      'href',
      '/vehicles/veh-1',
    )
    expect(within(row).getByText('$22,800')).toBeInTheDocument()
    expect(within(row).getByText('Green light')).toBeInTheDocument()
    expect(within(row).getByText(/Ends in/)).toBeInTheDocument()
    expect(screen.getByText('1 vehicles')).toBeInTheDocument()
  })

  it('shows starting bid and standing for the viewer', async () => {
    serve(
      vehicleList([
        vehicle({ id: 'a', auction: auction({ current_bid: null, bid_count: 0 }) }),
        vehicle({
          id: 'b',
          model: 'F-150',
          auction: auction({ has_bid: true, is_high_bidder: true }),
        }),
        vehicle({ id: 'c', model: 'Escape', auction: auction({ has_bid: true }) }),
      ]),
    )
    renderRoute('/')
    const noBids = await screen.findByRole('article', { name: '2023 Ford Bronco' })
    expect(within(noBids).getByText('Starting bid')).toBeInTheDocument()
    expect(within(noBids).getByText('No bids yet')).toBeInTheDocument()
    expect(
      within(screen.getByRole('article', { name: '2023 Ford F-150' })).getByText("You're winning"),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('article', { name: '2023 Ford Escape' })).getByText('Outbid'),
    ).toBeInTheDocument()
  })

  it('puts filters in the URL and refetches with them', async () => {
    const api = serve()
    const { router } = renderRoute('/')
    await screen.findByRole('article', { name: '2023 Ford Bronco' })

    const rail = screen.getByRole('complementary', { name: 'Filters' })
    await userEvent.click(within(rail).getByRole('checkbox', { name: /BMW/ }))

    expect(router.state.location.search).toBe('?make=BMW')
    await waitFor(() => expect(api.calls.at(-1)?.searchParams.getAll('make')).toEqual(['BMW']))
    expect(screen.getByRole('button', { name: 'Remove filter: BMW' })).toBeInTheDocument()
  })

  it('debounces search into the URL without stacking history entries', async () => {
    serve()
    const { router } = renderRoute('/')
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search inventory' }), 'bronco')
    await waitFor(() => expect(router.state.location.search).toBe('?q=bronco'))
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('suggests removing filters when nothing matches', async () => {
    serve(vehicleList([]))
    const { router } = renderRoute('/?make=Tesla&buy_now=true')
    expect(await screen.findByRole('heading', { name: 'No vehicles match' })).toBeInTheDocument()
    const chips = screen.getAllByRole('button', { name: 'Remove filter: Tesla' })
    await userEvent.click(chips.at(-1)!)
    expect(router.state.location.search).toBe('?buy_now=true')
  })

  it('offers a retry when the run list fails to load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 'invalid_request', message: 'Bad filter.' } }),
          {
            status: 422,
          },
        ),
      ),
    )
    renderRoute('/')
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the run list")
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('watches a vehicle optimistically', async () => {
    const api = serve()
    renderRoute('/')
    const star = await screen.findByRole('button', { name: 'Watch 2023 Ford Bronco' })
    await userEvent.click(star)
    expect(
      await screen.findByRole('button', { name: 'Stop watching 2023 Ford Bronco' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(api.calls.some((url) => url.pathname === '/api/me/watchlist/veh-1')).toBe(true)
  })
})
