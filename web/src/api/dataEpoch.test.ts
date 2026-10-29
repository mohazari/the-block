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

  it('lets a response move the epoch only forward: a late one from before is ignored', () => {
    const older = '2026-10-29T08:00:00+00:00'
    const newer = '2026-10-29T09:00:00+00:00'
    noteDataEpoch(older)
    expect(noteDataEpoch(newer, 'response')).toBe(true)
    expect(noteDataEpoch(older, 'response')).toBe(false) // straggler from the previous run
    expect(noteDataEpoch(older)).toBe(true) // but a hello saying so (a restored backup) wins
  })
})
