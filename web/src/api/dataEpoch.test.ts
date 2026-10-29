import { describe, expect, it, vi } from 'vitest'
import { noteServerRun, noteStreamDown, onReseed } from './dataEpoch'

describe('data epoch', () => {
  it('drops the cache for a new run with different data, even an older backup', () => {
    const reseeded = vi.fn()
    const stop = onReseed(reseeded)
    expect(noteServerRun('run-1', '2026-10-29T09:00:00+00:00', 'hello')).toBe(false) // recorded
    expect(noteServerRun('run-2', '2026-10-29T08:00:00+00:00', 'hello')).toBe(true) // older, new
    expect(reseeded).toHaveBeenCalledTimes(1)
    stop()
  })

  it('keeps the cache across a restart that kept the data', () => {
    noteServerRun('run-1', 'e', 'hello')
    expect(noteServerRun('run-2', 'e', 'hello')).toBe(false)
  })

  it('ignores a late response from a run it has moved on from', () => {
    noteServerRun('run-1', 'old', 'hello')
    noteStreamDown()
    expect(noteServerRun('run-2', 'new', 'response')).toBe(true) // stream down: news by response
    expect(noteServerRun('run-1', 'old', 'response')).toBe(false) // a straggler: no flip back
  })

  it('leaves new runs to the stream while it is connected', () => {
    noteServerRun('run-3', 'c', 'hello')
    // A late response from a run this tab never saw (it lived and died while the stream
    // reconnected) must not unseat the run the stream is connected to.
    expect(noteServerRun('run-2', 'b', 'response')).toBe(false)
    expect(noteServerRun('run-3', 'c', 'response')).toBe(false)
  })

  it('always believes a hello, even for a run it had retired', () => {
    noteServerRun('run-1', 'a', 'hello')
    noteStreamDown()
    noteServerRun('run-2', 'b', 'response')
    expect(noteServerRun('run-1', 'a', 'hello')).toBe(true) // the stream is connected to it
  })

  it('accepts an empty epoch as a value, but ignores a missing run', () => {
    noteServerRun('run-1', '', 'hello')
    expect(noteServerRun('run-2', '', 'hello')).toBe(false) // same (empty) data
    expect(noteServerRun(null, 'e', 'hello')).toBe(false)
  })
})
