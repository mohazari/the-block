/**
 * Which copy of the server's data the cache came from. Bid counts order snapshots, but they
 * restart when the server reseeds (`npm run reset-db`, or the automatic reseed) — so a changed
 * epoch means "drop the cache", not "compare". The API client reports the epoch from every
 * response header and the live stream from every hello.
 */
let known: string | undefined
const listeners = new Set<() => void>()

export function noteDataEpoch(epoch: string | null | undefined): void {
  if (!epoch) return
  const changed = known !== undefined && epoch !== known
  known = epoch
  if (changed) listeners.forEach((listener) => listener())
}

export function onDataEpochChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Test hook. */
export function resetDataEpoch(): void {
  known = undefined
}
