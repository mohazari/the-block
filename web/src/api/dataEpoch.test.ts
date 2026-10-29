import { describe, expect, it, vi } from 'vitest'
import { noteServerRun, onReseed } from './dataEpoch'

describe('data epoch', () => {
  it('drops the cache for a new run with different data, even an older backup', () => {
    const reseeded = vi.fn()
    const stop = onReseed(reseeded)
    expect(noteServerRun('run-1', '2026-10-29T09:00:00+00:00')).toBe(false) // first: recorded
    expect(noteServerRun('run-2', '2026-10-29T08:00:00+00:00')).toBe(true) // older, still new
    expect(reseeded).toHaveBeenCalledTimes(1)
    stop()
  })

  it('keeps the cache across a restart that kept the data', () => {
    noteServerRun('run-1', 'e')
    expect(noteServerRun('run-2', 'e')).toBe(false)
  })

  it('ignores a late response from a run it has moved on from', () => {
    noteServerRun('run-1', 'old')
    expect(noteServerRun('run-2', 'new')).toBe(true)
    expect(noteServerRun('run-1', 'old')).toBe(false) // a straggler: no flip back
    expect(noteServerRun('run-2', 'new')).toBe(false)
  })

  it('ignores a missing run or epoch', () => {
    expect(noteServerRun(null, 'e')).toBe(false)
    expect(noteServerRun('run-1', '')).toBe(false)
  })
})
