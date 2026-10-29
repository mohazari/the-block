import { describe, expect, it, vi } from 'vitest'
import { noteDataEpoch, onReseed } from './dataEpoch'

describe('data epoch', () => {
  it('treats any change as a reseed, including an older database', () => {
    const reseeded = vi.fn()
    const stop = onReseed(reseeded)
    expect(noteDataEpoch('b')).toBe('current') // first one: just recorded
    expect(noteDataEpoch('b')).toBe('current')
    expect(noteDataEpoch('a')).toBe('reseeded') // e.g. a restored backup: not "newer", still new
    expect(reseeded).toHaveBeenCalledTimes(1)
    stop()
  })

  it('discards a response sent before the last reset instead of flipping back', () => {
    noteDataEpoch('old')
    const sentBeforeReset = Date.now() - 1000
    expect(noteDataEpoch('new')).toBe('reseeded')
    expect(noteDataEpoch('old', sentBeforeReset)).toBe('stale')
    expect(noteDataEpoch('new', Date.now())).toBe('current')
  })

  it('ignores a missing or empty epoch', () => {
    expect(noteDataEpoch('')).toBe('current')
    expect(noteDataEpoch(null)).toBe('current')
  })
})
