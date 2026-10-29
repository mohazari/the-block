import { describe, expect, it, vi } from 'vitest'
import { noteDataEpoch, onReseed } from './dataEpoch'

describe('data epoch', () => {
  it('treats any change as a reseed, including an older database', () => {
    const reseeded = vi.fn()
    const stop = onReseed(reseeded)
    expect(noteDataEpoch('b')).toBe(false) // the first hello: just recorded
    expect(noteDataEpoch('b')).toBe(false)
    expect(noteDataEpoch('a')).toBe(true) // e.g. a restored backup: not "newer", still different
    expect(reseeded).toHaveBeenCalledTimes(1)
    stop()
  })

  it('ignores an empty epoch', () => {
    expect(noteDataEpoch('')).toBe(false)
    expect(noteDataEpoch('a')).toBe(false) // still the first real one
  })
})
