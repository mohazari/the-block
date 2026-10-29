import { useSyncExternalStore } from 'react'

/**
 * Countdowns run against the *server's* clock: a laptop that is two minutes fast must not show
 * an auction as closed while it is still taking bids. Responses carrying `server_time` (and the
 * live stream's hello) feed the offset; one shared ticker drives every countdown.
 */
let offsetMs = 0
// Round-trip of the sample the offset came from. Like NTP, slower samples are less precise, so a
// sample much slower than the best one seen is ignored instead of dragging the clock backwards.
let bestRoundTripMs = Number.POSITIVE_INFINITY
const SLACK_MS = 250

let now = Date.now()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

const notify = () => {
  now = serverNow()
  listeners.forEach((listener) => listener())
}

/**
 * @param sentAt / receivedAt local `Date.now()` around the request; the server stamped its time
 *   somewhere in between, so the midpoint is the best estimate. Omit both for push messages.
 */
export function syncServerTime(serverTimeIso: string, sentAt?: number, receivedAt?: number): void {
  const serverMs = Date.parse(serverTimeIso)
  if (Number.isNaN(serverMs)) return
  if (sentAt === undefined || receivedAt === undefined) {
    // A pushed timestamp has unknown latency: use it only until a measured sample exists, and
    // never let it outrank one.
    if (bestRoundTripMs === Number.POSITIVE_INFINITY) {
      offsetMs = serverMs - Date.now()
      notify()
    }
    return
  }
  const roundTrip = receivedAt - sentAt
  if (roundTrip > bestRoundTripMs + SLACK_MS) return
  bestRoundTripMs = Math.min(bestRoundTripMs, roundTrip)
  offsetMs = serverMs - (sentAt + receivedAt) / 2
  notify()
}

export const serverNow = (): number => Date.now() + offsetMs

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!timer) {
    now = serverNow() // the ticker was idle; don't hand a stale snapshot to the first subscriber
    timer = setInterval(notify, 1000)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

/** Server-corrected "now", re-rendering once a second while mounted. */
export function useServerNow(): number {
  return useSyncExternalStore(subscribe, () => now)
}

/** Test hook: forget all samples. */
export function resetServerClock(): void {
  offsetMs = 0
  bestRoundTripMs = Number.POSITIVE_INFINITY
  now = Date.now()
}
