import { fireEvent, screen, waitFor, within } from '@testing-library/react'
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
    expect(screen.getByText('1 vehicle')).toBeInTheDocument()
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

  it('watches a vehicle optimistically and keeps it after revalidating', async () => {
    const list = vehicleList([vehicle()])
    const api = stubApi((url, init) => {
      if (url.pathname === '/api/me/watchlist/veh-1') {
        list.items[0]!.watching = init?.method === 'PUT' // the server remembers
        return undefined
      }
      return url.pathname === '/api/vehicles' ? structuredClone(list) : undefined
    })
    vi.stubGlobal('fetch', api.fetch)
    renderRoute('/')
    const star = await screen.findByRole('button', { name: 'Watch 2023 Ford Bronco' })
    await userEvent.click(star)
    expect(
      await screen.findByRole('button', { name: 'Stop watching 2023 Ford Bronco' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(api.calls.some((url) => url.pathname === '/api/me/watchlist/veh-1')).toBe(true)
    await waitFor(() =>
      expect(api.calls.filter((url) => url.pathname === '/api/vehicles')).toHaveLength(2),
    )
    expect(
      screen.getByRole('button', { name: 'Stop watching 2023 Ford Bronco' }),
    ).toBeInTheDocument()
  })

  it('explains a page past the end instead of blaming the filters', async () => {
    serve(vehicleList([], { total: 30 }))
    renderRoute('/?page=5')
    expect(await screen.findByText('Page 5 is past the end of the list')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to the first page' })).toBeInTheDocument()
  })

  it('searches a long make list, keeping ticked makes in view', async () => {
    const makes = ['Audi', 'BMW', 'Chevrolet', 'Ford', 'GMC', 'Honda', 'Kia', 'Toyota']
    serve(
      vehicleList([vehicle()], {
        facets: { make: makes.map((value) => ({ value, count: 3 })) },
      }),
    )
    renderRoute('/?make=Toyota')
    const rail = within(await screen.findByRole('complementary', { name: 'Filters' }))
    expect(await rail.findByRole('button', { name: 'Show 1 more' })).toBeInTheDocument()

    await userEvent.type(rail.getByRole('searchbox', { name: 'Search makes' }), 'for')
    expect(rail.getByRole('checkbox', { name: /Ford/ })).toBeInTheDocument()
    expect(rail.getByRole('checkbox', { name: /Toyota/ })).toBeChecked()
    expect(rail.queryByRole('checkbox', { name: /BMW/ })).not.toBeInTheDocument()
    expect(rail.queryByRole('button', { name: /Show/ })).not.toBeInTheDocument()

    await userEvent.click(rail.getByRole('checkbox', { name: /Toyota/ }))
    await userEvent.clear(rail.getByRole('searchbox', { name: 'Search makes' }))
    await userEvent.type(rail.getByRole('searchbox', { name: 'Search makes' }), 'zzz')
    expect(rail.getByRole('status')).toHaveTextContent('No makes match “zzz”.')
  })

  it('shows the range of the page it is on', async () => {
    serve(vehicleList([vehicle()], { total: 30 }))
    renderRoute('/?page=2')
    expect(await screen.findByText(/25–30 of\s*30/)).toBeInTheDocument()
  })

  it('explains an invalid range instead of applying it', async () => {
    serve()
    const { router } = renderRoute('/')
    const rail = within(await screen.findByRole('complementary', { name: 'Filters' }))
    await userEvent.type(rail.getByLabelText('Min model year'), '20')
    await userEvent.tab()
    expect(rail.getByText('Enter a year like 2020.')).toBeInTheDocument()
    expect(rail.getByLabelText('Min model year')).toHaveAttribute('aria-invalid', 'true')
    expect(router.state.location.search).toBe('')
  })

  it('clears an invalid range and its hint on "Clear all"', async () => {
    serve()
    renderRoute('/?make=Ford')
    const rail = within(await screen.findByRole('complementary', { name: 'Filters' }))
    const year = rail.getByLabelText('Min model year')
    await userEvent.type(year, '20')
    await userEvent.tab()
    expect(rail.getByText('Enter a year like 2020.')).toBeInTheDocument()

    await userEvent.click(rail.getByRole('button', { name: 'Clear all' }))
    expect(rail.queryByText('Enter a year like 2020.')).not.toBeInTheDocument()
    expect(year).toHaveValue(null)
    expect(year).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('cuts an over-long paste at a whole character and keeps what was typed', async () => {
    serve()
    renderRoute('/')
    const box = screen.getByRole('searchbox', { name: 'Search inventory' })
    await userEvent.type(box, 'ford')
    await userEvent.click(box)
    await userEvent.paste('🚗'.repeat(60)) // 120 UTF-16 units: only 48 cars fit after "ford"
    expect(box).toHaveValue(`ford${'🚗'.repeat(48)}`)
  })

  it('measures pasted line breaks as the spaces the box turns them into', async () => {
    serve()
    renderRoute('/')
    const box = screen.getByRole('searchbox', { name: 'Search inventory' })
    await userEvent.click(box)
    await userEvent.paste('🚗\r\n'.repeat(40)) // 120 units as the box holds it: "🚗 " x 40
    expect(box).toHaveValue('🚗 '.repeat(33)) // 99 units: one more car (2) would pass 100
  })

  it('measures a paste without its trailing line break, as Firefox inserts it', async () => {
    serve()
    renderRoute('/')
    const box = screen.getByRole('searchbox', { name: 'Search inventory' })
    await userEvent.type(box, 'x'.repeat(98))
    // "ab" fits the 2 units left: the browser should do this paste itself, not the handler.
    const browserDoesIt = fireEvent.paste(box, { clipboardData: { getData: () => 'ab\n' } })
    expect(browserDoesIt).toBe(true) // not cancelled
  })
})
