import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import type { AuctionStatus, InventoryQuery, SortOrder } from '../../api/types'

/**
 * The inventory's filters live in the URL: links are shareable, the back button works, and a
 * refresh keeps your place. Defaults are left out of the URL to keep it short.
 */
export const LIST_FILTERS = [
  'status',
  'make',
  'body_style',
  'province',
  'fuel_type',
  'drivetrain',
  'title_status',
] as const
export type ListFilter = (typeof LIST_FILTERS)[number]

export const NUMBER_FILTERS = [
  'year_min',
  'year_max',
  'price_min',
  'price_max',
  'odometer_max',
  'grade_min',
] as const
export type NumberFilter = (typeof NUMBER_FILTERS)[number]

export const SORTS: { value: SortOrder; label: string }[] = [
  { value: 'ending_soon', label: 'Ending soonest' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'year_desc', label: 'Newest model year' },
  { value: 'odometer_asc', label: 'Lowest mileage' },
  { value: 'grade_desc', label: 'Best condition' },
  { value: 'most_bids', label: 'Most bids' },
]

export const PAGE_SIZE = 24

export function parseInventoryQuery(params: URLSearchParams): InventoryQuery {
  const query: InventoryQuery = { page_size: PAGE_SIZE }
  const q = params.get('q')?.trim()
  if (q) query.q = q
  for (const key of LIST_FILTERS) {
    const values = params.getAll(key).filter(Boolean)
    if (values.length) (query[key] as string[]) = values
  }
  for (const key of NUMBER_FILTERS) {
    const raw = params.get(key)?.trim()
    const value = Number(raw)
    if (raw && Number.isFinite(value)) query[key] = value
  }
  if (params.get('buy_now') === 'true') query.buy_now = true
  if (params.get('watching') === 'true') query.watching = true
  const sort = params.get('sort') as SortOrder | null
  if (sort && SORTS.some((option) => option.value === sort)) query.sort = sort
  const page = Number(params.get('page'))
  if (Number.isInteger(page) && page > 1) query.page = page
  return query
}

export type FilterPatch = Partial<{
  [K in ListFilter]: string[]
}> &
  Partial<{ [K in NumberFilter]: number | null }> & {
    q?: string | null
    buy_now?: boolean
    watching?: boolean
    sort?: SortOrder
    page?: number
  }

export function useInventoryParams() {
  const [params, setParams] = useSearchParams()
  const query = useMemo(() => parseInventoryQuery(params), [params])

  /** Merge changes into the URL. Any change other than paging returns to page 1. */
  const update = useCallback(
    (patch: FilterPatch, { replace = false }: { replace?: boolean } = {}) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          for (const [key, value] of Object.entries(patch)) {
            next.delete(key)
            if (Array.isArray(value)) value.forEach((item) => next.append(key, item))
            else if (value !== null && value !== undefined && value !== '' && value !== false)
              next.set(key, String(value))
          }
          if (!('page' in patch)) next.delete('page')
          if (next.get('sort') === 'ending_soon') next.delete('sort')
          if (next.get('page') === '1') next.delete('page')
          return next
        },
        // flushSync: these inputs are controlled by the URL, and a transition would let a
        // clicked checkbox snap back for a moment (caught by the e2e tests).
        { replace, flushSync: true },
      )
    },
    [setParams],
  )

  const clearAll = useCallback(() => {
    setParams(
      (current) => {
        const next = new URLSearchParams()
        const sort = current.get('sort')
        if (sort) next.set('sort', sort)
        return next
      },
      { flushSync: true },
    )
  }, [setParams])

  return { query, update, clearAll }
}

/** How many filters (not search, sort or paging) are active — for the mobile "Filters (3)". */
export function activeFilterCount(query: InventoryQuery): number {
  const lists = LIST_FILTERS.reduce((count, key) => count + (query[key]?.length ?? 0), 0)
  const numbers = NUMBER_FILTERS.filter((key) => query[key] != null).length
  return lists + numbers + (query.buy_now ? 1 : 0) + (query.watching ? 1 : 0)
}

export const STATUS_LABEL: Record<AuctionStatus, string> = {
  live: 'Live now',
  upcoming: 'Upcoming',
  ended: 'Ended',
}
