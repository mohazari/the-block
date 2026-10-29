/**
 * Which copy of the server's data the cache came from. Bid counts order snapshots, but they
 * restart when the data is reseeded — so a different epoch means "drop the cache", not
 * "compare". The data only changes between server runs (reset-db refuses while a server is up),
 * and each run's epoch arrives with every hello and on every API response (for a tab whose
 * stream is down).
 *
 * A hello is authoritative: any change is a reseed, even to an older epoch (a restored backup).
 * A response may be a late one from the previous run, so it can only move the epoch forward;
 * epochs are the time the data was seeded.
 */
let known: string | undefined
let reseeds = 0
const listeners = new Set<() => void>()

/** Records an epoch; returns whether the data was reseeded since the last one. */
export function noteDataEpoch(
  epoch: string | null | undefined,
  from: 'hello' | 'response' = 'hello',
): boolean {
  if (!epoch || epoch === known) return false
  if (from === 'response' && known !== undefined && !(Date.parse(epoch) > Date.parse(known))) {
    return false // older (or unreadable): a straggler from before; the next hello decides
  }
  const reseeded = known !== undefined
  known = epoch
  if (reseeded) {
    reseeds += 1
    listeners.forEach((listener) => listener())
  }
  return reseeded
}

/**
 * How many reseeds this tab has seen. A response to a request made before the latest one may
 * be answered from the old data, so callers compare this before and after (a counter, not a
 * time: the system clock can jump).
 */
export const reseedCount = (): number => reseeds

export function onReseed(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Test hook. */
export function resetDataEpoch(): void {
  known = undefined
  reseeds = 0
}
