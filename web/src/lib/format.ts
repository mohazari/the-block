const currency = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  currencyDisplay: 'narrowSymbol',
  maximumFractionDigits: 0,
})
const integer = new Intl.NumberFormat('en-CA')

export const formatMoney = (dollars: number): string => currency.format(dollars)

export const formatKm = (km: number): string => `${integer.format(km)} km`

/** "2d 4h", "3h 12m", "4m 09s", "12s" — precision grows as the deadline approaches. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}

const clockTime = new Intl.DateTimeFormat('en-CA', {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
})

export const formatClockTime = (iso: string): string => clockTime.format(new Date(iso))

const sentenceCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

/** Dataset vocabulary → buyer-facing labels. */
export function label(value: string): string {
  const known: Record<string, string> = {
    SUV: 'SUV',
    CVT: 'CVT',
    AWD: 'AWD',
    FWD: 'FWD',
    RWD: 'RWD',
    '4WD': '4WD',
    'single-speed': 'Single-speed',
  }
  return known[value] ?? sentenceCase(value.replaceAll('_', ' '))
}
