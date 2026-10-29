/**
 * Which copy of the server's data the cache came from. Bid counts order snapshots, but they
 * restart when the data is reseeded — so a different epoch means "drop the cache", not
 * "compare". The server performs every reseed itself and nothing else can reset its database,
 * so its epoch is exact; it arrives with every hello (the server ends all streams when it
 * reseeds, so every tab reconnects) and on every API response (for a tab whose stream is down).
 * Any change is a reseed. In one rare race — a stream opening as a reset happens — a hello with
 * the old epoch can arrive after the new one; that causes one extra reset, and it converges,
 * since everything the server sends afterwards carries the new epoch.
 */
let known: string | undefined
let reseeds = 0
const listeners = new Set<() => void>()

/** Records an epoch; returns whether the data was reseeded since the last one. */
export function noteDataEpoch(epoch: string | null | undefined): boolean {
  if (!epoch || epoch === known) return false
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
