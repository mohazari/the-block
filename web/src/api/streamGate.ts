/**
 * Subscribe first, then read. Data fetched before the live stream is subscribed can miss a bid
 * committed in between, so initial GETs wait until the stream says hello — capped, so a blocked
 * stream (proxy, offline server) only delays the page briefly instead of stalling it.
 */
const WAIT_CAP_MS = 1500

let state: 'waiting' | 'live' | 'gave-up' = 'waiting'
let release: () => void = () => {}
let gate = new Promise<void>((resolve) => (release = resolve))
let cap: ReturnType<typeof setTimeout> | undefined

function open(next: 'live' | 'gave-up') {
  state = next
  clearTimeout(cap)
  release()
}

/** Resolves once reads are safe: the stream is live, or the cap has passed. */
export function waitForStream(): Promise<void> {
  if (state !== 'waiting') return Promise.resolve()
  cap ??= setTimeout(() => open('gave-up'), WAIT_CAP_MS)
  return gate
}

/**
 * Called on every hello. Returns whether data may have been read before this subscription
 * (a reconnect, or the cap expired first) — i.e. whether what's cached must be refetched.
 */
export function streamLive(): boolean {
  const readBeforeSubscribing = state !== 'waiting'
  open('live')
  return readBeforeSubscribing
}

/** Test hooks. */
export function resetStreamGate(): void {
  clearTimeout(cap)
  cap = undefined
  state = 'waiting'
  gate = new Promise<void>((resolve) => (release = resolve))
}
export const openStreamGate = (): void => open('live')
