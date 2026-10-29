import { describe, expect, it } from 'vitest'
import { activeFilterCount, limitSearch, parseInventoryQuery } from './inventoryParams'
import { activeChips } from './activeChips'

describe('parseInventoryQuery', () => {
  it('reads repeated keys, numbers and flags from the URL', () => {
    const query = parseInventoryQuery(
      new URLSearchParams(
        'q=bronco&make=Ford&make=BMW&price_max=30000&buy_now=true&page=2&sort=price_asc',
      ),
    )
    expect(query).toEqual({
      page_size: 24,
      q: 'bronco',
      make: ['Ford', 'BMW'],
      price_max: 30000,
      buy_now: true,
      page: 2,
      sort: 'price_asc',
    })
  })

  it('ignores junk instead of sending it to the API', () => {
    const query = parseInventoryQuery(
      new URLSearchParams('sort=cheapest&page=-3&year_min=abc&price_max='),
    )
    expect(query).toEqual({ page_size: 24 })
  })
})

describe('active filters', () => {
  it('counts filters but not search, sort or paging', () => {
    const query = parseInventoryQuery(
      new URLSearchParams('q=x&make=Ford&make=BMW&grade_min=3&watching=true&sort=price_asc&page=2'),
    )
    expect(activeFilterCount(query)).toBe(4)
  })

  it('describes each filter as a removable chip', () => {
    const chips = activeChips(
      parseInventoryQuery(
        new URLSearchParams('q=bronco&make=Ford&make=BMW&price_min=10000&price_max=20000'),
      ),
    )
    expect(chips.map((chip) => chip.text)).toEqual(['"bronco"', 'Ford', 'BMW', '$10,000 – $20,000'])
    expect(chips[1]!.remove).toEqual({ make: ['BMW'] })
    expect(chips[3]!.remove).toEqual({ price_min: null, price_max: null })
  })
})

describe('URL values the API would reject', () => {
  it('drops unknown statuses and out-of-range or fractional numbers', () => {
    const query = parseInventoryQuery(
      new URLSearchParams(
        'status=live&status=foo&year_min=20&price_min=-1&price_max=15000.5&odometer_max=50000&grade_min=9',
      ),
    )
    expect(query).toEqual({ page_size: 24, status: ['live'], odometer_max: 50000 })
  })

  it('swaps inverted ranges instead of sending them', () => {
    const query = parseInventoryQuery(new URLSearchParams('year_min=2024&year_max=2018'))
    expect(query).toMatchObject({ year_min: 2018, year_max: 2024 })
  })

  it("trims search text to the API's 100-character limit", () => {
    const query = parseInventoryQuery(new URLSearchParams({ q: 'x'.repeat(150) }))
    expect(query.q).toHaveLength(100)
  })

  it('drops numbers too large to send as plain integers', () => {
    // 1e21 is an "integer" to JavaScript but would be sent as "1e+21", which the API rejects.
    const query = parseInventoryQuery(new URLSearchParams('price_min=1e21&odometer_max=1e21'))
    expect(query).toEqual({ page_size: 24 })
  })

  it('never cuts a character in half when trimming search text', () => {
    const query = parseInventoryQuery(new URLSearchParams({ q: `${'x'.repeat(99)}🚗🚗` }))
    expect(query.q).toBe(`${'x'.repeat(99)}🚗`)
  })

  it('never cuts a multi-part emoji, and counts code points like the server', () => {
    const family = '👨‍👩‍👧' // 5 code points: three people joined by zero-width joiners
    expect(limitSearch(`${'x'.repeat(97)}${family}`)).toBe('x'.repeat(97))
    expect(limitSearch(`${'x'.repeat(95)}${family}`)).toBe(`${'x'.repeat(95)}${family}`)
  })
})
