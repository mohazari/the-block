import type { InventoryQuery } from '../../api/types'
import { formatKm, formatMoney, label } from '../../lib/format'
import { LIST_FILTERS, STATUS_LABEL, type FilterPatch } from './inventoryParams'

export interface Chip {
  key: string
  text: string
  remove: FilterPatch
}

/** Every active filter as a removable chip — also reused by the empty state. */
export function activeChips(query: InventoryQuery): Chip[] {
  const chips: Chip[] = []
  if (query.q) chips.push({ key: 'q', text: `"${query.q}"`, remove: { q: null } })
  for (const key of LIST_FILTERS) {
    const values = query[key] ?? []
    for (const value of values) {
      const text =
        key === 'status' ? STATUS_LABEL[value as keyof typeof STATUS_LABEL] : label(value)
      chips.push({
        key: `${key}:${value}`,
        text,
        remove: { [key]: values.filter((item) => item !== value) },
      })
    }
  }
  const range = (
    low: number | null | undefined,
    high: number | null | undefined,
    fmt: (n: number) => string,
  ) =>
    low != null && high != null
      ? `${fmt(low)} – ${fmt(high)}`
      : low != null
        ? `${fmt(low)}+`
        : `Up to ${fmt(high!)}`
  if (query.price_min != null || query.price_max != null)
    chips.push({
      key: 'price',
      text: range(query.price_min, query.price_max, formatMoney),
      remove: { price_min: null, price_max: null },
    })
  if (query.year_min != null || query.year_max != null)
    chips.push({
      key: 'year',
      text: range(query.year_min, query.year_max, String),
      remove: { year_min: null, year_max: null },
    })
  if (query.odometer_max != null)
    chips.push({
      key: 'odometer',
      text: `Under ${formatKm(query.odometer_max)}`,
      remove: { odometer_max: null },
    })
  if (query.grade_min != null)
    chips.push({
      key: 'grade',
      text: `Grade ${query.grade_min.toFixed(1)}+`,
      remove: { grade_min: null },
    })
  if (query.buy_now) chips.push({ key: 'buy_now', text: 'Buy Now', remove: { buy_now: false } })
  if (query.watching) chips.push({ key: 'watching', text: 'Watching', remove: { watching: false } })
  return chips
}
