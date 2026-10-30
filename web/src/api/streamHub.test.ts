import { beforeEach, describe, expect, it } from 'vitest'
import { FakeEventSource } from '../test/fakeEventSource'
import {
  CLOSED,
  CONNECT_TIMEOUT_MS,
  CONNECTING,
  StreamHub,
  type FromHub,
  type ToHub,
} from './streamHub'

const URL_A = '/api/events?bidder_id=me'
const HEARTBEAT_MS = 10_000

/** A tab's end of the worker connection: records what the hub sends it. */
class FakePort {
  received: FromHub[] = []
  onmessage: ((event: MessageEvent<ToHub>) => void) | null = null
  id = 0
  private onClose?: () => void
  postMessage(message: FromHub) {
    this.received.push(message)
  }
  addEventListener(_type: 'close', listener: () => void) {
    this.onClose = listener
  }
  send(message: ToHub) {
    this.onmessage?.(new MessageEvent('message', { data: message }))
  }
  /** The tab's stream object (re)joins, as after a reconnect. */
  open(fresh = false) {
    this.id += 1
    this.send({ type: 'open', id: this.id, url: URL_A, fresh })
  }
  close() {
    this.send({ type: 'close', id: this.id })
  }
  /** The browser reports the tab gone. */
  gone() {
    this.onClose?.()
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
  FakeEventSource.latest().emit('hello', {
    server_time: serverTime,
    epoch: 'e',
    run: 'r',
    heartbeat_seconds: HEARTBEAT_MS / 1000,
  })

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
    expect(first.events('bid')).toEqual([expect.objectContaining({ id: 1 })])
    expect(second.events('bid')).toHaveLength(1)
  })

  it('greets a tab that joins an open stream with the last hello, its clock moved on', () => {
    tab().open()
    hello('2026-10-28T12:00:00.000Z')
    now += 5_000
    const late = tab()
    late.open()
    const [replayed] = late.events('hello') as Extract<FromHub, { type: 'event' }>[]
    expect(JSON.parse(replayed!.data)).toMatchObject({
      server_time: '2026-10-28T12:00:05.000Z',
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

  it('tags each message with the tab stream it is for, so old ones can be told apart', () => {
    const port = tab()
    port.open()
    hello()
    port.close()
    port.open() // id 2
    FakeEventSource.latest().emit('bid', {})
    expect(port.received.at(-1)).toMatchObject({ type: 'event', name: 'bid', id: 2 })
  })

  it('restarts a quiet stream for every tab when one finds it dead', () => {
    const watcher = tab()
    watcher.open()
    const reporter = tab()
    reporter.open()
    hello()
    const before = FakeEventSource.latest()
    now += HEARTBEAT_MS * 2 // no pings since: the connection died without telling anyone

    reporter.close()
    reporter.open(true)
    expect(before.closed).toBe(true)
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(watcher.received.at(-1)).toEqual({ type: 'error', id: 1, readyState: CONNECTING })

    hello()
    expect(watcher.events('hello')).toHaveLength(2)
    expect(reporter.events('hello')).toHaveLength(2)
  })

  it("doesn't restart a stream that is still delivering: the asking tab only rejoins", () => {
    const healthy = tab()
    healthy.open()
    const sleeper = tab()
    sleeper.open()
    hello()
    now += HEARTBEAT_MS
    FakeEventSource.latest().emit('ping', {})
    now += 1_000

    // A background tab woke up, its watchdog saw "silence", and it asks for a fresh stream.
    sleeper.close()
    sleeper.open(true)
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(healthy.received.some((m) => m.type === 'error')).toBe(false)
    expect(sleeper.events('hello').at(-1)).toMatchObject({ id: 2 }) // greeted as connected
  })

  it('shares one restart between tabs that ask at once', () => {
    const tabs = [tab(), tab(), tab()]
    tabs.forEach((port) => port.open())
    hello()
    now += HEARTBEAT_MS * 2
    tabs.forEach((port) => {
      port.close()
      port.open(true)
    })
    expect(FakeEventSource.instances).toHaveLength(2) // the first restart; the rest join it
  })

  it('replaces a connection that never finishes connecting', () => {
    const first = tab()
    first.open()
    tab().open()
    now += CONNECT_TIMEOUT_MS - 1
    first.close()
    first.open(true)
    expect(FakeEventSource.instances).toHaveLength(1) // still within reason: wait for it
    now += 1
    first.close()
    first.open(true)
    expect(FakeEventSource.instances).toHaveLength(2) // hung: replaced
  })

  it('restarts a stream the browser gave up on, for any tab that joins it', () => {
    const first = tab()
    first.open()
    tab().open()
    FakeEventSource.latest().fail({ fatal: true })
    expect(first.received.at(-1)).toEqual({ type: 'error', id: 1, readyState: CLOSED })
    tab().open() // a new tab, not even asking for a fresh one
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  it('ignores a replaced connection that still delivers events', () => {
    const first = tab()
    first.open()
    tab().open()
    hello()
    const old = FakeEventSource.latest()
    now += HEARTBEAT_MS * 2
    first.close()
    first.open(true)
    old.emit('bid', { vehicle_id: 'late' })
    expect(first.events('bid')).toHaveLength(0)
  })

  it('closes the connection when the last tab leaves, or its port reports it gone', () => {
    const only = tab()
    only.open()
    const source = FakeEventSource.latest()
    only.close()
    expect(source.closed).toBe(true)

    const other = tab()
    other.open()
    other.gone()
    expect(FakeEventSource.latest().closed).toBe(true)
  })

  it("ignores a goodbye from a tab's older stream", () => {
    const port = tab()
    port.open()
    port.send({ type: 'close', id: port.id - 1 }) // late, for a stream already replaced
    expect(FakeEventSource.latest().closed).toBe(false)
  })
})
