/**
 * Anonymous bidder identity. No accounts in this prototype: each browser gets a random id that
 * the API uses for "you're winning", My bids and the watchlist.
 */
const STORAGE_KEY = 'the-block:bidder-id'

let memoryFallback: string | undefined

/**
 * A v4 UUID. `crypto.randomUUID` only exists in secure contexts, so a phone testing the dev
 * server over plain http on a LAN address would otherwise get no id at all.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function bidderId(): string {
  try {
    let id = localStorage.getItem(STORAGE_KEY)
    if (!id) {
      id = newId()
      localStorage.setItem(STORAGE_KEY, id)
    }
    return id
  } catch {
    // Private mode or blocked storage: still works for this tab, just not across reloads.
    memoryFallback ??= newId()
    return memoryFallback
  }
}
