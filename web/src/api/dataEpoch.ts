/**
 * Which copy of the server's data the cache came from. Bid counts order snapshots, but they
 * restart when the data is reseeded — so a different epoch means "drop the cache", not
 * "compare". It arrives with every hello: the server ends all live streams when it reseeds
 * (and a restarted server starts new ones), so every tab reconnects and hears about it. One
 * stream delivers hellos in order, so any change is a reseed.
 */
let known: string | undefined
let reseeds = 0
const listeners = new Set<() => void>()

/** Records a hello's epoch; returns whether the data was reseeded since the last one. */
export function noteDataEpoch(epoch: string): boolean {
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
