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
  closed = false
  close() {
    this.closed = true
  }
  reply(message: FromHub) {
    this.onmessage?.(new MessageEvent('message', { data: message }))
  }
}

let port: FakeWorkerPort
let worker: { port: FakeWorkerPort; onerror: (() => void) | null }
beforeEach(() => {
  resetSharedStream()
  port = new FakeWorkerPort()
  worker = { port, onerror: null }
  // `new SharedWorker(...)` returns the fake: a constructor may return an object.
  vi.stubGlobal('SharedWorker', function SharedWorker() {
    return worker
  })
  vi.stubGlobal('EventSource', FakeEventSource)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const lastId = () => (port.sent.at(-1) as { id: number }).id

describe('openEventStream', () => {
  it('asks the shared worker for the stream and hands its events on', () => {
    const stream = openEventStream('/api/events?bidder_id=me')
    expect(port.sent).toEqual([
      { type: 'open', id: lastId(), url: '/api/events?bidder_id=me', fresh: false },
    ])
    const hellos: string[] = []
    stream.addEventListener('hello', (event) => hellos.push(event.data))
    port.reply({ type: 'event', id: lastId(), name: 'hello', data: '{"run":"r"}' })
    expect(hellos).toEqual(['{"run":"r"}'])
    expect(stream.readyState).toBe(OPEN)
  })

  it('reports errors with the shared stream state', () => {
    const stream = openEventStream('/x')
    const onerror = vi.fn()
    stream.onerror = onerror
    port.reply({ type: 'error', id: lastId(), readyState: CLOSED })
    expect(onerror).toHaveBeenCalledOnce()
    expect(stream.readyState).toBe(CLOSED)
  })

  it('drops messages meant for a stream the tab has replaced', () => {
    const old = openEventStream('/x')
    const oldId = lastId()
    old.close()
    const fresh = openEventStream('/x', { fresh: 'stale', run: 'r2' })
    expect(port.sent.at(-1)).toEqual({
      type: 'open',
      id: lastId(),
      url: '/x',
      fresh: 'stale',
      run: 'r2',
    })
    const heard = vi.fn()
    fresh.addEventListener('hello', heard)
    fresh.onerror = heard
    // Still in flight for the old one when the new one opened.
    port.reply({ type: 'event', id: oldId, name: 'hello', data: '{}' })
    port.reply({ type: 'error', id: oldId, readyState: CLOSED })
    expect(heard).not.toHaveBeenCalled()
    expect(fresh.readyState).not.toBe(CLOSED)
  })

  it('leaves the hub when closed, but not when the tab reconnects at once', async () => {
    const first = openEventStream('/x')
    first.close()
    openEventStream('/x', { fresh: 'quiet' }) // a reconnect takes its place: no goodbye
    await Promise.resolve()
    expect(port.sent.map((m) => m.type)).toEqual(['open', 'open'])

    const last = openEventStream('/x')
    const id = lastId()
    last.close() // unmounting: nothing follows
    await Promise.resolve()
    expect(port.sent.at(-1)).toEqual({ type: 'close', id })
  })

  it('carries on over its own EventSource when the worker fails to load', () => {
    const stream = openEventStream('/x')
    const hellos: string[] = []
    stream.addEventListener('hello', (event) => hellos.push(event.data))
    worker.onerror?.()
    expect(FakeEventSource.latest().url).toBe('/x')
    FakeEventSource.latest().emit('hello', { run: 'r' })
    expect(hellos).toEqual(['{"run":"r"}'])
    expect(stream.readyState).toBe(OPEN)
    openEventStream('/x') // and opens its own from then on
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(port.sent).toHaveLength(1)
    expect(port.closed).toBe(true) // the tab stops talking to the worker
  })

  it('carries on over its own EventSource when the worker cannot open one', () => {
    const stream = openEventStream('/x')
    const onerror = vi.fn()
    stream.onerror = onerror
    port.reply({ type: 'unavailable', id: lastId() })
    expect(onerror).toHaveBeenCalledOnce() // shown as reconnecting until its own says hello
    expect(stream.readyState).not.toBe(CLOSED) // not given up: no retry delay
    expect(FakeEventSource.latest().url).toBe('/x')
    FakeEventSource.latest().fail()
    expect(onerror).toHaveBeenCalledTimes(2)
    stream.close()
    expect(FakeEventSource.latest().closed).toBe(true)
  })

  it('still says goodbye when closed after the shared stream failed', async () => {
    const stream = openEventStream('/x')
    port.reply({ type: 'error', id: lastId(), readyState: CLOSED })
    stream.close()
    await Promise.resolve()
    expect(port.sent.at(-1)).toEqual({ type: 'close', id: lastId() })
  })

  it('says goodbye when the page goes away, and hello when it comes back', () => {
    openEventStream('/x')
    const id = lastId()
    window.dispatchEvent(new Event('pagehide'))
    expect(port.sent.filter((m) => m.type === 'close')).toEqual([{ type: 'close', id }])
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
    expect(port.sent.at(-1)).toEqual({ type: 'open', id, url: '/x', fresh: false })
  })

  it('gives up on a worker that answers nothing, after two quiet reconnects', () => {
    // As liveEvents reconnects: close the old stream, open the next.
    openEventStream('/x').close()
    openEventStream('/x', { fresh: 'quiet' }).close() // unanswered once: maybe just slow
    expect(port.closed).toBe(false)
    const own = openEventStream('/x', { fresh: 'quiet' }) // twice: the worker is gone
    expect(port.closed).toBe(true)
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.latest().url).toBe('/x')
    own.close()
    openEventStream('/x')
    expect(FakeEventSource.instances).toHaveLength(2) // its own from then on
  })

  it('keeps a worker that answers its quiet reconnects', () => {
    for (let i = 0; i < 3; i++) {
      openEventStream('/x', { fresh: 'quiet' })
      port.reply({ type: 'event', id: lastId(), name: 'hello', data: '{}' })
    }
    expect(port.closed).toBe(false)
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('uses its own EventSource where there is no SharedWorker', () => {
    vi.stubGlobal('SharedWorker', undefined)
    openEventStream('/x')
    expect(FakeEventSource.latest().url).toBe('/x')
  })

  it('uses its own EventSource where storage is blocked (the bidder id may differ per tab)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    openEventStream('/x')
    expect(port.sent).toEqual([])
    expect(FakeEventSource.latest().url).toBe('/x')
  })
})
