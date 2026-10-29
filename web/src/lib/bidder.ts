/**
 * Anonymous bidder identity. No accounts in this prototype: each browser gets a random id that
 * the API uses for "you're winning", My bids and the watchlist.
 */
const STORAGE_KEY = 'the-block:bidder-id'

let cached: string | null = null

export function bidderId(): string {
  if (cached) return cached
  try {
    cached = localStorage.getItem(STORAGE_KEY)
    if (!cached) {
      cached = crypto.randomUUID()
      localStorage.setItem(STORAGE_KEY, cached)
    }
  } catch {
    // Private mode or blocked storage: still works for this tab, just not across reloads.
    cached ??= crypto.randomUUID()
  }
  return cached
}
