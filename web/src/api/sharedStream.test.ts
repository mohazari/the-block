import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeEventSource } from '../test/fakeEventSource'
import { openEventStream, resetSharedStream } from './sharedStream'
import { CLOSED, OPEN, type FromHub, type ToHub } from './streamHub'

/** The worker's end of the tab's port: records what the tab sends, and can answer. */
class FakeWorkerPort {
  sent: ToHub[] = []
  onmessage: ((event: MessageEvent<FromHub>) => void) | null = null
  postMessage(message: ToHub) {
    this.sent.push(message)
  }
  start() {}
  reply(message: FromHub) {
    this.onmessage?.(new MessageEvent('message', { data: message }))
  }
}

let port: FakeWorkerPort
beforeEach(() => {
  resetSharedStream()
  port = new FakeWorkerPort()
  vi.stubGlobal(
    'SharedWorker',
    class {
      port = port
    },
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('openEventStream', () => {
  it('asks the shared worker for the stream and hands its events on', () => {
    const stream = openEventStream('/api/events?bidder_id=me')
    expect(port.sent).toEqual([{ type: 'open', url: '/api/events?bidder_id=me', fresh: false }])
    const hellos: string[] = []
    stream.addEventListener('hello', (event) => hellos.push(event.data))
    port.reply({ type: 'event', name: 'hello', data: '{"run":"r"}' })
    expect(hellos).toEqual(['{"run":"r"}'])
    expect(stream.readyState).toBe(OPEN)
  })

  it('reports errors with the shared stream state', () => {
    const stream = openEventStream('/x')
    const onerror = vi.fn()
    stream.onerror = onerror
    port.reply({ type: 'error', readyState: CLOSED })
    expect(onerror).toHaveBeenCalledOnce()
    expect(stream.readyState).toBe(CLOSED)
  })

  it('lets only the newest stream in a tab listen, and asks for a fresh one on request', () => {
    const old = openEventStream('/x')
    old.close()
    const fresh = openEventStream('/x', { fresh: true })
    expect(port.sent.slice(1)).toEqual([
      { type: 'close' },
      { type: 'open', url: '/x', fresh: true },
    ])
    const heard = vi.fn()
    old.addEventListener('bid', heard)
    fresh.addEventListener('bid', heard)
    port.reply({ type: 'event', name: 'bid', data: '{}' })
    expect(heard).toHaveBeenCalledOnce()
  })

  it('uses its own EventSource where there is no SharedWorker', () => {
    vi.stubGlobal('SharedWorker', undefined)
    resetSharedStream()
    vi.stubGlobal('EventSource', FakeEventSource)
    openEventStream('/x')
    expect(FakeEventSource.latest().url).toBe('/x')
  })

  it('uses its own EventSource where storage is blocked (the bidder id may differ per tab)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.stubGlobal('EventSource', FakeEventSource)
    openEventStream('/x')
    expect(port.sent).toEqual([])
    expect(FakeEventSource.latest().url).toBe('/x')
  })
})
