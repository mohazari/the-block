import { describe, expect, it, vi } from 'vitest'
import { noteDataEpoch, onReseed } from './dataEpoch'

describe('data epoch', () => {
  it('reports a reseed only when the epoch moves forward', () => {
    const reseeded = vi.fn()
    const stop = onReseed(reseeded)
    expect(noteDataEpoch('2026-10-29T08:00:00Z')).toBe(false) // first one: just recorded
    expect(noteDataEpoch('2026-10-29T08:00:00Z')).toBe(false)
    expect(noteDataEpoch('2026-10-29T09:00:00Z')).toBe(true)
    // A response stamped before the reseed but delivered after it can't flip back.
    expect(noteDataEpoch('2026-10-29T08:00:00Z')).toBe(false)
    expect(reseeded).toHaveBeenCalledTimes(1)
    stop()
  })

  it('ignores a missing or empty epoch', () => {
    expect(noteDataEpoch('')).toBe(false)
    expect(noteDataEpoch(null)).toBe(false)
    expect(noteDataEpoch('2026-10-29T08:00:00Z')).toBe(false) // still the first real one
  })
})
