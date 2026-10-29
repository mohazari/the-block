/**
 * Which copy of the server's data the cache came from. Bid counts order snapshots, but they
 * restart when the server reseeds (`npm run reset-db`, the automatic reseed, a restored or
 * different database) — so a different epoch means "drop the cache", not "compare".
 *
 * Epochs are opaque: any change is a reseed. They arrive two ways: every hello (authoritative;
 * the server ends all streams on a reseed, so even idle tabs reconnect) and every API response
 * header (for a tab whose stream is down, or the seconds before it reconnects). A response to a
 * request sent before the last reset is stale — it was answered from the old data — so it
 * neither flips the epoch back nor gets applied.
 */
export type EpochVerdict = 'current' | 'reseeded' | 'stale'

let known: string | undefined
let lastResetAt = Number.NEGATIVE_INFINITY
const listeners = new Set<() => void>()

/** @param requestSentAt when the request was sent (omit for hello, which is always current). */
export function noteDataEpoch(
  epoch: string | null | undefined,
  requestSentAt?: number,
): EpochVerdict {
  if (!epoch || epoch === known) return 'current'
  if (known === undefined) {
    known = epoch
    return 'current'
  }
  // Same millisecond counts as before: when it's ambiguous, retrying is the safe side.
  if (requestSentAt !== undefined && requestSentAt <= lastResetAt) return 'stale'
  known = epoch
  lastResetAt = Date.now()
  listeners.forEach((listener) => listener())
  return 'reseeded'
}

export function onReseed(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Test hook. */
export function resetDataEpoch(): void {
  known = undefined
  lastResetAt = Number.NEGATIVE_INFINITY
}
