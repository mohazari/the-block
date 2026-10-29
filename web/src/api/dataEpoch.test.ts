import { describe, expect, it, vi } from 'vitest'
import {
  currentRunId,
  noteHello,
  noteResponse,
  noteStreamDown,
  onReseed,
  onStaleStream,
} from './dataEpoch'

describe('data epoch', () => {
  it('drops the cache for a new run with different data, even an older backup', () => {
    const reseeded = vi.fn()
    const stop = onReseed(reseeded)
    expect(noteHello('run-1', '2026-10-29T09:00:00+00:00')).toBe(false) // first: recorded
    expect(noteHello('run-2', '2026-10-29T08:00:00+00:00')).toBe(true) // older, still new
    expect(reseeded).toHaveBeenCalledTimes(1)
    stop()
  })

  it('keeps the cache across a restart that kept the data', () => {
    noteHello('run-1', 'e')
    expect(noteHello('run-2', 'e')).toBe(false)
  })

  it('treats a response from a run it has moved on from as other data', () => {
    noteHello('run-1', 'old')
    noteStreamDown()
    expect(noteResponse('run-2', 'new', currentRunId())).toBe(true) // adopted: newer
    expect(noteResponse('run-1', 'old', 'run-1')).toBe(false) // a straggler: no flip back
    expect(currentRunId()).toBe('run-2')
  })

  it('adopts a new run from a response even while the stream looks connected', () => {
    const stale = vi.fn()
    const stop = onStaleStream(stale)
    noteHello('run-1', 'a')
    // The stream says run-1, but run-2 answered: run-1 is gone and the stream died silently.
    expect(noteResponse('run-2', 'b', currentRunId())).toBe(true)
    expect(currentRunId()).toBe('run-2')
    expect(stale).toHaveBeenCalledTimes(1) // and the stream is told to reconnect
    stop()
  })

  it('sets aside a response from an unseen run if the tab moved runs while it was in flight', () => {
    const stale = vi.fn()
    const stop = onStaleStream(stale)
    noteHello('run-1', 'a')
    const sent = currentRunId() // a request goes out...
    noteHello('run-3', 'c') // ...the stream reconnects to run-3 meanwhile...
    // ...and run-2 answers, which lived and died in between (or not: it can't be ordered).
    expect(noteResponse('run-2', 'b', sent)).toBe(false)
    expect(currentRunId()).toBe('run-3')
    expect(stale).not.toHaveBeenCalled() // the healthy stream stays
    stop()
  })

  it('still adopts a new run after a reconnect to the same run', () => {
    noteHello('run-1', 'a')
    const sent = currentRunId()
    noteHello('run-1', 'a') // the stream blipped and came back to run-1
    expect(noteResponse('run-2', 'b', sent)).toBe(true) // still the newest news
  })

  it('always believes a hello, even for a run it had retired', () => {
    noteHello('run-1', 'a')
    noteStreamDown()
    noteResponse('run-2', 'b', currentRunId())
    expect(noteHello('run-1', 'a')).toBe(true) // the stream is connected to it
  })

  it('adopts the run even if a listener throws', () => {
    const stopStale = onStaleStream(() => {
      throw new Error('no EventSource here')
    })
    const stopReseed = onReseed(() => {
      throw new Error('cache trouble')
    })
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    noteHello('run-1', 'a')
    expect(noteResponse('run-2', 'b', currentRunId())).toBe(true)
    expect(currentRunId()).toBe('run-2')
    expect(quiet).toHaveBeenCalledTimes(2) // both failures reported, neither escaped
    quiet.mockRestore()
    stopStale()
    stopReseed()
  })

  it('accepts an empty epoch as a value', () => {
    noteHello('run-1', '')
    expect(noteHello('run-2', '')).toBe(false) // same (empty) data
  })
})
