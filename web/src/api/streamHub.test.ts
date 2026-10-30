import { beforeEach, describe, expect, it } from 'vitest'
import { FakeEventSource } from '../test/fakeEventSource'
import {
  CLOSED,
  CONNECTING,
  RESTART_AFTER_MS,
  StreamHub,
  type FromHub,
  type ToHub,
} from './streamHub'

const URL_A = '/api/events?bidder_id=me'

/** A tab's end of the worker connection: records what the hub sends it. */
class FakePort {
  received: FromHub[] = []
  onmessage: ((event: MessageEvent<ToHub>) => void) | null = null
  postMessage(message: FromHub) {
    this.received.push(message)
  }
  send(message: ToHub) {
    this.onmessage?.(new MessageEvent('message', { data: message }))
  }
  open(fresh = false) {
    this.send({ type: 'open', url: URL_A, fresh })
  }
  events(name: string) {
    return this.received.filter((m) => m.type === 'event' && m.name === name)
  }
}

let now = 0
let hub: StreamHub
const tab = () => {
  const port = new FakePort()
  hub.connect(port)
  return port
}
const hello = (serverTime = '2026-10-28T12:00:00.000Z') =>
  FakeEventSource.latest().emit('hello', { server_time: serverTime, epoch: 'e', run: 'r' })

beforeEach(() => {
  now = 1_000_000
  hub = new StreamHub(
    (url) => new FakeEventSource(url),
    () => now,
  )
})

describe('StreamHub', () => {
  it('serves every tab from one connection', () => {
    const first = tab()
    first.open()
    const second = tab()
    second.open()
    expect(FakeEventSource.instances).toHaveLength(1)

    FakeEventSource.latest().emit('bid', { vehicle_id: 'v1' })
    expect(first.events('bid')).toHaveLength(1)
    expect(second.events('bid')).toHaveLength(1)
  })

  it('greets a tab that joins an open stream with the last hello, its clock moved on', () => {
    tab().open()
    hello('2026-10-28T12:00:00.000Z')
    now += 5_000
    const late = tab()
    late.open()
    const [replayed] = late.events('hello') as Extract<FromHub, { type: 'event' }>[]
    expect(JSON.parse(replayed!.data)).toEqual({
      server_time: '2026-10-28T12:00:05.000Z',
      epoch: 'e',
      run: 'r',
    })
  })

  it('makes a joining tab wait for the hello while the stream is still connecting', () => {
    tab().open()
    const second = tab()
    second.open()
    expect(second.received).toEqual([])
    hello()
    expect(second.events('hello')).toHaveLength(1)
  })

  it('restarts the stream for every tab when one finds it dead', () => {
    const watcher = tab()
    watcher.open()
    const reporter = tab()
    reporter.open()
    hello()
    const before = FakeEventSource.latest()
    now += RESTART_AFTER_MS

    reporter.send({ type: 'close' })
    reporter.open(true)
    expect(before.closed).toBe(true)
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(watcher.received.at(-1)).toEqual({ type: 'error', readyState: CONNECTING })

    hello()
    expect(watcher.events('hello')).toHaveLength(2)
    expect(reporter.events('hello')).toHaveLength(2)
  })

  it('shares one restart between tabs that ask at once', () => {
    const tabs = [tab(), tab(), tab()]
    tabs.forEach((port) => port.open())
    hello()
    now += RESTART_AFTER_MS
    tabs.forEach((port) => {
      port.send({ type: 'close' })
      port.open(true)
    })
    expect(FakeEventSource.instances).toHaveLength(2) // the first restart; the rest join it
  })

  it("doesn't restart a stream that only just connected", () => {
    const first = tab()
    first.open()
    tab().open()
    hello()
    now += RESTART_AFTER_MS - 1
    first.send({ type: 'close' })
    first.open(true)
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(first.events('hello')).toHaveLength(2) // the replay
  })

  it('restarts a stream the browser gave up on, however new', () => {
    const first = tab()
    first.open()
    tab().open()
    FakeEventSource.latest().fail({ fatal: true })
    expect(first.received.at(-1)).toEqual({ type: 'error', readyState: CLOSED })
    first.send({ type: 'close' })
    first.open(true)
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  it('ignores a replaced connection that still delivers events', () => {
    const first = tab()
    first.open()
    tab().open()
    hello()
    const old = FakeEventSource.latest()
    now += RESTART_AFTER_MS
    first.send({ type: 'close' })
    first.open(true)
    old.emit('bid', { vehicle_id: 'late' })
    expect(first.events('bid')).toHaveLength(0)
  })

  it('closes the connection when the last tab leaves', () => {
    const only = tab()
    only.open()
    const source = FakeEventSource.latest()
    only.send({ type: 'close' })
    expect(source.closed).toBe(true)
    only.open()
    expect(FakeEventSource.instances).toHaveLength(2)
  })
})
