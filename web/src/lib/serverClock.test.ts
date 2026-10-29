import { describe, expect, it } from 'vitest'
import { serverNow, syncServerTime } from './serverClock'

describe('serverClock', () => {
  it('corrects for half the round trip', () => {
    const sentAt = Date.now() - 400
    const receivedAt = Date.now()
    const server = new Date(sentAt + 200 + 60_000).toISOString() // server is a minute ahead
    syncServerTime(server, sentAt, receivedAt)
    expect(Math.abs(serverNow() - Date.now() - 60_000)).toBeLessThan(50)
  })

  it('ignores samples much slower than the best seen', () => {
    const t = Date.now()
    syncServerTime(new Date(t + 10_000).toISOString(), t - 20, t) // fast sample: +10s
    syncServerTime(new Date(t - 50_000).toISOString(), t - 5_000, t) // slow and far off
    expect(Math.abs(serverNow() - Date.now() - 10_000)).toBeLessThan(100)
  })

  it('never lets a pushed timestamp outrank a measured one', () => {
    const t = Date.now()
    syncServerTime(new Date(t + 10_000).toISOString(), t - 20, t) // measured: +10s
    syncServerTime(new Date(Date.now() + 90_000).toISOString()) // pushed, unknown latency
    expect(Math.abs(serverNow() - Date.now() - 10_000)).toBeLessThan(100)
  })
})
