/** How often the server pings a quiet stream, until a hello says otherwise. */
export const DEFAULT_HEARTBEAT_MS = 10_000
// An announced heartbeat that isn't a positive number is ignored; extremes are clamped.
const LIMITS_MS = [1_000, 600_000] as const

/** The ping interval a hello's `heartbeat_seconds` announces, in ms; undefined if none. */
export function announcedHeartbeat(seconds: unknown): number | undefined {
  if (typeof seconds !== 'number' || !(seconds > 0)) return undefined
  const [shortest, longest] = LIMITS_MS
  return Math.min(Math.max(seconds * 1000, shortest), longest)
}
