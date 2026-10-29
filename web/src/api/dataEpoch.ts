/**
 * Which copy of the server's data the cache came from. Bid counts order snapshots, but they
 * restart when the server reseeds (`npm run reset-db`, or the automatic reseed) — so a changed
 * epoch means "drop the cache", not "compare". It arrives with every hello: on a reseed the
 * server ends all live streams, so even an idle tab reconnects and learns about it.
 */
let known: string | undefined

/** Records the epoch from a hello; returns whether the data was reseeded since the last one. */
export function noteDataEpoch(epoch: string): boolean {
  const reseeded = known !== undefined && epoch !== known
  known = epoch
  return reseeded
}

/** Test hook. */
export function resetDataEpoch(): void {
  known = undefined
}
