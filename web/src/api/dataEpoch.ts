/**
 * Which copy of the server's data the cache came from. Bid counts order snapshots, but they
 * restart when the data is reseeded — so a different epoch means "drop the cache", not
 * "compare". The data only changes between server runs (reset-db refuses while a server is up);
 * every hello and API response names the run (a random id per server process) and its epoch.
 *
 * Runs, not clocks, tell old from new. A hello is authoritative: its stream is connected to
 * that run right now, so it is adopted, whatever came before. A response may be a late one
 * from an earlier run, so it only counts while the stream is down (otherwise the stream will
 * say), and never for a run this tab has moved on from. Adopting a run drops the cache only if
 * its epoch differs: a restart that kept the data keeps it, a restored backup doesn't.
 */
let currentRun: string | undefined
let knownEpoch: string | undefined
let streamConnected = false
const retiredRuns = new Set<string>()
let reseeds = 0
const listeners = new Set<() => void>()

/** Records a run and its epoch; returns whether the data was reseeded since the last one. */
export function noteServerRun(
  run: string | null | undefined,
  epoch: string | null | undefined,
  from: 'hello' | 'response',
): boolean {
  if (!run || epoch == null) return false
  if (from === 'hello') streamConnected = true
  if (run === currentRun) return false
  if (from === 'response' && (streamConnected || retiredRuns.has(run))) return false
  retiredRuns.delete(run)
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

/** The live stream dropped: until the next hello, responses may report a new run. */
export function noteStreamDown(): void {
  streamConnected = false
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
  streamConnected = false
  knownEpoch = undefined
  retiredRuns.clear()
  reseeds = 0
}
