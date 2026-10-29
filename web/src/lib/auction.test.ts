import { describe, expect, it } from 'vitest'
import { auction } from '../test/fixtures'
import { standingAt, statusAt } from './auction'

describe('statusAt', () => {
  it('flips at the boundaries', () => {
    const a = auction({ starts_at: '2026-10-28T12:00:00Z', ends_at: '2026-10-28T13:00:00Z' })
    expect(statusAt(a, Date.parse('2026-10-28T11:59:59Z'))).toBe('upcoming')
    expect(statusAt(a, Date.parse('2026-10-28T12:00:00Z'))).toBe('live')
    expect(statusAt(a, Date.parse('2026-10-28T13:00:00Z'))).toBe('ended')
  })
})

describe('standingAt', () => {
  it('is nothing for buyers who never bid', () => {
    expect(standingAt(auction(), 'live')).toBeNull()
  })

  it('uses the API vocabulary while open', () => {
    expect(standingAt(auction({ has_bid: true, is_high_bidder: true }), 'live')).toBe('leading')
    expect(standingAt(auction({ has_bid: true }), 'live')).toBe('outbid')
  })

  it('infers the result from the reserve before the server reports an outcome', () => {
    const leader = { has_bid: true, is_high_bidder: true, outcome: null }
    expect(standingAt(auction({ ...leader, reserve_status: 'not_met' }), 'ended')).toBe('lost')
    expect(standingAt(auction({ ...leader, reserve_status: 'met' }), 'ended')).toBe('won')
    expect(standingAt(auction({ ...leader, outcome: 'reserve_not_met' }), 'ended')).toBe('lost')
  })
})
