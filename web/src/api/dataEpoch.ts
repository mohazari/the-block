/**
 * Which copy of the server's data the cache came from. Bid counts order snapshots, but they
 * restart when the data is reseeded — so a different epoch means "drop the cache", not
 * "compare". The data only changes between server runs (reset-db refuses while a server is up);
 * every hello and API response names the run (a random id per server process) and its epoch.
 *
 * Runs, not clocks, tell old from new: a run this tab has moved on from is a late response from
 * a previous process, so it's ignored; any other new run is adopted, and drops the cache only if
 * its epoch differs (a restart without a reset keeps it). A restored backup is a new run with a
 * different epoch, so it counts, whatever the timestamps say.
 */
let currentRun: string | undefined
let knownEpoch: string | undefined
const retiredRuns = new Set<string>()
let reseeds = 0
const listeners = new Set<() => void>()

/** Records a run and its epoch; returns whether the data was reseeded since the last one. */
export function noteServerRun(
  run: string | null | undefined,
  epoch: string | null | undefined,
): boolean {
  if (!run || !epoch || run === currentRun || retiredRuns.has(run)) return false
  if (currentRun !== undefined) retiredRuns.add(currentRun)
  currentRun = run
  const reseeded = knownEpoch !== undefined && epoch !== knownEpoch
  knownEpoch = epoch
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
  currentRun = undefined
  knownEpoch = undefined
  retiredRuns.clear()
  reseeds = 0
}
