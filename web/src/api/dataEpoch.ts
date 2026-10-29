/**
 * Which copy of the server's data the cache came from. Bid counts order snapshots, but they
 * restart when the data is reseeded — so a different epoch means "drop the cache", not
 * "compare". It arrives with every hello: the server ends all live streams when it reseeds
 * (and a restarted server starts new ones), so every tab reconnects and hears about it. One
 * stream delivers hellos in order, so any change is a reseed.
 */
let known: string | undefined
const listeners = new Set<() => void>()

/** Records a hello's epoch; returns whether the data was reseeded since the last one. */
export function noteDataEpoch(epoch: string): boolean {
  if (!epoch || epoch === known) return false
  const reseeded = known !== undefined
  known = epoch
  if (reseeded) listeners.forEach((listener) => listener())
  return reseeded
}

export function onReseed(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Test hook. */
export function resetDataEpoch(): void {
  known = undefined
}
