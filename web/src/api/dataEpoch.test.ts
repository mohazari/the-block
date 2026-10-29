import { describe, expect, it, vi } from 'vitest'
import {
  helloCount,
  isCurrentRun,
  noteServerRun,
  noteStreamDown,
  noteStreamUp,
  onReseed,
  onStaleStream,
} from './dataEpoch'

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
    expect(noteServerRun('run-2', 'new', 'response', helloCount())).toBe(true) // stream down: news by response
    expect(noteServerRun('run-1', 'old', 'response', helloCount())).toBe(false) // a straggler: no flip back
  })

  it('adopts a new run from a response even while the stream looks connected', () => {
    const stale = vi.fn()
    const stop = onStaleStream(stale)
    noteStreamUp()
    noteServerRun('run-1', 'a', 'hello')
    // The stream says run-1, but run-2 answered: run-1 is gone and the stream died silently.
    expect(noteServerRun('run-2', 'b', 'response', helloCount())).toBe(true) // no mixing a's and b's data
    expect(stale).toHaveBeenCalledTimes(1) // and the stream is told to reconnect
    stop()
  })

  it('always believes a hello, even for a run it had retired', () => {
    noteServerRun('run-1', 'a', 'hello')
    noteStreamDown()
    noteServerRun('run-2', 'b', 'response', helloCount())
    expect(noteServerRun('run-1', 'a', 'hello')).toBe(true) // the stream is connected to it
  })

  it('accepts an empty epoch as a value, but ignores a missing run', () => {
    noteServerRun('run-1', '', 'hello')
    expect(noteServerRun('run-2', '', 'hello')).toBe(false) // same (empty) data
    expect(noteServerRun(null, 'e', 'hello')).toBe(false)
  })

  it('ignores a response that was in flight while a hello arrived: the hello is newer', () => {
    const stale = vi.fn()
    const stop = onStaleStream(stale)
    noteStreamUp()
    noteServerRun('run-1', 'a', 'hello')
    const sent = helloCount() // a request goes out...
    noteStreamUp() // ...the stream reconnects to run-3 meanwhile...
    noteServerRun('run-3', 'c', 'hello')
    // ...and the answer comes from run-2, which lived and died in between.
    expect(noteServerRun('run-2', 'b', 'response', sent)).toBe(false)
    expect(stale).not.toHaveBeenCalled() // the healthy stream stays
    expect(isCurrentRun('run-2')).toBe(false) // and its data isn't applied
    stop()
  })

  it('adopts the run even if reconnecting the stale stream throws', () => {
    const stop = onStaleStream(() => {
      throw new Error('no EventSource here')
    })
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    noteStreamUp()
    noteServerRun('run-1', 'a', 'hello')
    expect(noteServerRun('run-2', 'b', 'response', helloCount())).toBe(true)
    expect(isCurrentRun('run-2')).toBe(true)
    quiet.mockRestore()
    stop()
  })
})
