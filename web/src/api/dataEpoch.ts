/**
 * Which copy of the server's data the cache came from. Bid counts order snapshots, but they
 * restart when the data is reseeded — so a different epoch means "drop the cache", not
 * "compare". The data only changes between server runs (reset-db refuses while a server is up);
 * every hello and API response names the run (a random id per server process) and its epoch.
 *
 * Runs, not clocks, tell old from new. A hello is authoritative: its stream is connected to
 * that run right now, so it is adopted, whatever came before. A response from a run this tab
 * has moved on from is a late straggler and ignored, and so is one that was in flight while a
 * hello arrived (the hello is newer). Otherwise a response from a run it has never seen is
 * adopted at once — even while the stream looks connected, since it proves that stream is
 * stale (it died without telling us), so the stream is also told to reconnect; its hello then
 * settles it. Adopting a run drops the cache only if its epoch differs: a restart that kept the
 * data keeps it, a restored backup doesn't.
 */
let currentRun: string | undefined
let knownEpoch: string | undefined
let streamConnected = false
let hellos = 0
const retiredRuns = new Set<string>()
let reseeds = 0
const listeners = new Set<() => void>()
const staleStreamListeners = new Set<() => void>()

/** How many hellos have arrived; a response compares it with the count when it was sent. */
export const helloCount = (): number => hellos

/**
 * Records a run and its epoch; returns whether the data was reseeded since the last one.
 * For a response, `hellosWhenSent` is helloCount() from when its request was sent.
 */
export function noteServerRun(
  run: string | null | undefined,
  epoch: string | null | undefined,
  from: 'hello' | 'response',
  hellosWhenSent?: number,
): boolean {
  if (!run || epoch == null || run === currentRun) return false
  let streamIsStale = false
  if (from === 'response') {
    if (retiredRuns.has(run) || hellosWhenSent !== hellos) return false // older news
    // Another server answered, yet the stream says it's connected: it isn't any more.
    streamIsStale = streamConnected
    streamConnected = false
  }
  retiredRuns.delete(run)
  if (currentRun !== undefined) retiredRuns.add(currentRun)
  currentRun = run
  const reseeded = knownEpoch !== undefined && epoch !== knownEpoch
  knownEpoch = epoch
  if (reseeded) {
    reseeds += 1
    listeners.forEach((listener) => listener())
  }
  if (streamIsStale) {
    // After adopting the run, and guarded: a failing reconnect mustn't undo what this response
    // showed, or turn a good response into an error.
    staleStreamListeners.forEach((listener) => {
      try {
        listener()
      } catch (error) {
        console.error('Reconnecting the live stream failed', error)
      }
    })
  }
  return reseeded
}

/** Whether `run` is the run this tab is on: data from any other must not be applied. */
export const isCurrentRun = (run: string | null | undefined): boolean =>
  !run || currentRun === undefined || run === currentRun

/** A hello arrived: the stream is connected (to the run it names). */
export function noteStreamUp(): void {
  streamConnected = true
  hellos += 1
}

/** The live stream dropped, or was closed. */
export function noteStreamDown(): void {
  streamConnected = false
}

/** Called when a response shows the stream is connected to a server that's gone. */
export function onStaleStream(listener: () => void): () => void {
  staleStreamListeners.add(listener)
  return () => staleStreamListeners.delete(listener)
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
  hellos = 0
  knownEpoch = undefined
  retiredRuns.clear()
  reseeds = 0
}
