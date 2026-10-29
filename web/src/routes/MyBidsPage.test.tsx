import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MyBid } from '../api/types'
import { auction, stubApi, vehicle, vehicleList } from '../test/fixtures'
import { renderRoute } from '../test/render'

afterEach(() => vi.unstubAllGlobals())

function serve(bids: MyBid[], watched = vehicleList([])) {
  vi.stubGlobal(
    'fetch',
    stubApi((url) =>
      url.pathname === '/api/me/bids'
        ? bids
        : url.pathname === '/api/vehicles'
          ? watched
          : undefined,
    ).fetch,
  )
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

  it('invites you to the run list when there is nothing to show', async () => {
    serve([])
    renderRoute('/my-bids')
    expect(
      await screen.findByRole('heading', { name: 'No bids or watched vehicles yet' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse the run list' })).toHaveAttribute('href', '/')
  })
})
