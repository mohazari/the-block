/**
 * Which copy of the server's data the cache came from. Bid counts order snapshots, but they
 * restart when the data is reseeded — so a different epoch means "drop the cache", not
 * "compare". The data only changes between server runs (reset-db refuses while a server is up);
 * every hello and API response names the run (a random id per server process) and its epoch.
 *
 * Runs, not clocks, tell old from new, by one rule: a response belongs to the data this tab is
 * on if its run is the tab's run. A hello is authoritative (its stream is connected to that run
 * now), so it is always adopted. A response from a run the tab has never seen is adopted too —
 * it answered after the tab last heard anything — unless the tab moved to another run while it
 * was in flight (then it can't be ordered against that run, so it is set aside). Adopting from
 * a response while the stream looks connected proves the stream is stale, so it reconnects; its
 * hello then settles it. A run the tab has moved on from is a late straggler. Adopting a run
 * drops the cache only if its epoch differs: a restart that kept the data keeps it.
 */
let currentRun: string | undefined
let knownEpoch: string | undefined
let streamConnected = false
const retiredRuns = new Set<string>()
let reseeds = 0
const reseedListeners = new Set<() => void>()
const staleStreamListeners = new Set<() => void>()

/** Listeners can't undo a run change, or turn a good response into an error. */
function notify(listeners: Set<() => void>, what: string): void {
  listeners.forEach((listener) => {
    try {
      listener()
    } catch (error) {
      console.error(`${what} failed`, error)
    }
  })
}

function adopt(run: string, epoch: string): boolean {
  retiredRuns.delete(run)
  if (currentRun !== undefined) retiredRuns.add(currentRun)
  currentRun = run
  const reseeded = knownEpoch !== undefined && epoch !== knownEpoch
  knownEpoch = epoch
  if (reseeded) {
    reseeds += 1
    notify(reseedListeners, 'Dropping the cache after a reseed')
  }
  return reseeded
}

/** The run this tab is on: a request records it when sent, to judge its response by. */
export const currentRunId = (): string | undefined => currentRun

/** A hello: the stream is connected to `run`. Returns whether the data was reseeded. */
export function noteHello(run: string, epoch: string): boolean {
  streamConnected = true
  return run === currentRun ? false : adopt(run, epoch)
}

/**
 * What a response's headers say. Returns whether its data belongs to the data this tab is on
 * (true when it names no run: then there's nothing to go on). `runWhenSent` is currentRunId()
 * from when the request was sent.
 */
export function noteResponse(
  run: string | null,
  epoch: string | null,
  runWhenSent: string | undefined,
): boolean {
  if (!run || epoch === null || run === currentRun) return true
  if (retiredRuns.has(run) || currentRun !== runWhenSent) return false
  const streamIsStale = streamConnected // another server answered: the stream isn't connected
  streamConnected = false
  adopt(run, epoch)
  if (streamIsStale) notify(staleStreamListeners, 'Reconnecting the live stream')
  return true
}

/** The live stream dropped, or was closed. */
export function noteStreamDown(): void {
  streamConnected = false
}

/**
 * How many reseeds this tab has seen. For a response that names no run, comparing this before
 * and after is the only way to tell it may describe old data (a counter, not a time: the
 * system clock can jump).
 */
export const reseedCount = (): number => reseeds

export function onReseed(listener: () => void): () => void {
  reseedListeners.add(listener)
  return () => reseedListeners.delete(listener)
}

/** Called when a response shows the stream is connected to a server that's gone. */
export function onStaleStream(listener: () => void): () => void {
  staleStreamListeners.add(listener)
  return () => staleStreamListeners.delete(listener)
}

/** Test hook. */
export function resetDataEpoch(): void {
  currentRun = undefined
  knownEpoch = undefined
  streamConnected = false
  retiredRuns.clear()
  reseeds = 0
}
