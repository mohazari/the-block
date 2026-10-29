/**
 * Which copy of the server's data the cache came from. Bid counts order snapshots, but they
 * restart when the data is reseeded — so a different epoch means "drop the cache", not
 * "compare". The data only changes between server runs (reset-db refuses while a server is up);
 * every hello and API response names the run (a random id per server process) and its epoch.
 *
 * Two questions, kept apart. Which run is the tab on? Runs, not clocks, decide: a hello is
 * authoritative (its stream is connected to that run now); a response from a run the tab has
 * never seen is adopted too — it answered after the tab last heard anything — unless the tab
 * moved runs while it was in flight (then it can't be ordered, so it's left out). Adopting from
 * a response while the stream looks connected proves the stream is stale, so it reconnects; its
 * hello settles it. Adopting a run drops the cache only if its epoch differs.
 *
 * Does a response's data match the cache's? That's the epoch: a late answer from an earlier run
 * with the same data (a restart without a reset) still describes it — good enough for a bid's
 * outcome. A read must also come from the run the tab is on now: a late one can predate bids
 * the tab missed while reconnecting, so it's read again. A response missing either header falls
 * back to "was there a reseed while it was in flight?".
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

/** What a request records when sent, to judge its response by (see noteResponse). */
export interface SentWith {
  readonly run: string | undefined
  readonly reseeds: number
}
export const sentWith = (): SentWith => ({ run: currentRun, reseeds })

/** Test hook: the run this tab is on (responses are judged with sentWith/noteResponse). */
export const currentRunId = (): string | undefined => currentRun

export interface Verdict {
  /** Answered from the same data as the cache's. */
  readonly sameData: boolean
  /** ...and by the run the tab is on now (or there was no run to go on). */
  readonly current: boolean
}

/** A hello: the stream is connected to `run`. Returns whether the data was reseeded. */
export function noteHello(run: string, epoch: string): boolean {
  streamConnected = true
  return run === currentRun ? false : adopt(run, epoch)
}

/** Notes what a response's headers say, and judges it (see Verdict). */
export function noteResponse(run: string | null, epoch: string | null, sent: SentWith): Verdict {
  if (!run || epoch === null) {
    const unchanged = reseeds === sent.reseeds // nothing better to go on
    return { sameData: unchanged, current: unchanged }
  }
  if (run !== currentRun && !retiredRuns.has(run) && currentRun === sent.run) {
    const streamIsStale = streamConnected // another server answered: the stream isn't connected
    streamConnected = false
    adopt(run, epoch)
    if (streamIsStale) notify(staleStreamListeners, 'Reconnecting the live stream')
  }
  return { sameData: epoch === knownEpoch, current: run === currentRun && epoch === knownEpoch }
}

/** The live stream dropped, or was closed. */
export function noteStreamDown(): void {
  streamConnected = false
}

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
