/**
 * Which copy of the server's data the cache came from. Bid counts order snapshots, but they
 * restart when the server reseeds (`npm run reset-db`, or the automatic reseed) — so a newer
 * epoch means "drop the cache", not "compare". It arrives two ways: every hello (the server
 * ends all streams on a reseed, so even idle tabs reconnect) and every API response header (for
 * a tab whose stream is down, or the seconds before it reconnects).
 */
let known: string | undefined
const listeners = new Set<() => void>()

/**
 * Records an epoch; returns whether it means the data was reseeded. Epochs are seeding
 * timestamps, so they only move forward: a response stamped before a reseed but delivered
 * after one can't flip the cache back.
 */
export function noteDataEpoch(epoch: string | null | undefined): boolean {
  if (!epoch || (known !== undefined && epoch <= known)) return false
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
