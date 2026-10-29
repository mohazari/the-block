import { describe, expect, it } from 'vitest'
import { activeFilterCount, parseInventoryQuery } from './inventoryParams'
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
