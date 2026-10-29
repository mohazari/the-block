import { useSyncExternalStore } from 'react'

/**
 * Countdowns run against the *server's* clock: a laptop that is two minutes fast must not show
 * an auction as closed while it is still taking bids. Every response that carries `server_time`
 * (and the live stream's hello) updates the offset; one shared ticker drives every countdown.
 */
let offsetMs = 0
let now = Date.now()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

export function syncServerTime(serverTimeIso: string): void {
  const serverMs = Date.parse(serverTimeIso)
  if (!Number.isNaN(serverMs)) offsetMs = serverMs - Date.now()
}

export const serverNow = (): number => Date.now() + offsetMs

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!timer) {
    timer = setInterval(() => {
      now = serverNow()
      listeners.forEach((notify) => notify())
    }, 1000)
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
