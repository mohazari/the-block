import { afterEach, describe, expect, it, vi } from 'vitest'
import { bidderId } from './bidder'

afterEach(() => vi.unstubAllGlobals())

describe('bidderId', () => {
  it('is stable across calls', () => {
    expect(bidderId()).toBe(bidderId())
  })

  it('still works where crypto.randomUUID is missing (plain http on a LAN)', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
    expect(bidderId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})
