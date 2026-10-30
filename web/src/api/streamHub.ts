/**
 * One live stream for every tab. Browsers allow about six open connections per site, and each
 * tab used to hold one /api/events stream for good: with enough tabs open, a new tab's requests
 * queued behind the streams and never ran ("Loading vehicles…" forever). The hub runs in a
 * SharedWorker (liveStream.worker.ts), keeps one EventSource per URL, and relays it to the tabs
 * over their ports. Tabs keep all their own logic (watchdog, reconnects, reseeds): to them the
 * relay looks like an EventSource (sharedStream.ts).
 *
 * This file is the hub's logic only, with no worker globals, so tests can drive it.
 */

/** Tab → hub. `fresh`: the tab found the stream dead or stale and wants a new connection. */
export type ToHub = { type: 'open'; url: string; fresh: boolean } | { type: 'close' }

/** Hub → tab: a server event, or the stream's state after an error. */
export type FromHub =
  { type: 'event'; name: string; data: string } | { type: 'error'; readyState: number }

export interface Port {
  postMessage(message: FromHub): void
  onmessage: ((event: MessageEvent<ToHub>) => void) | null
  start?(): void
}

export interface Source {
  readonly readyState: number
  onerror: ((event: Event) => void) | null
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void
  close(): void
}

export const CONNECTING = 0
export const OPEN = 1
export const CLOSED = 2

/** The server's event names (see server/app/routers/events.py). */
export const EVENT_NAMES = ['hello', 'ping', 'bid', 'sold'] as const

/**
 * A request for a fresh connection restarts the stream for every tab, unless it's already
 * connecting or connected only a moment ago: then another tab got there first, and the tabs
 * asking at the same time (they all notice a dead stream together) share that one restart.
 */
export const RESTART_AFTER_MS = 2_000

interface Stream {
  url: string
  source: Source
  openedAt: number
  ports: Set<Port>
  /** The last hello and when it arrived: replayed to tabs that join an open stream. */
  hello?: { data: string; at: number }
}

export class StreamHub {
  private readonly streams = new Map<string, Stream>()
  private readonly joined = new Map<Port, Stream>()
  private readonly createSource: (url: string) => Source
  private readonly now: () => number

  constructor(createSource: (url: string) => Source, now: () => number = Date.now) {
    this.createSource = createSource
    this.now = now
  }

  connect(port: Port): void {
    port.onmessage = (event) => this.receive(port, event.data)
    port.start?.()
  }

  private receive(port: Port, message: ToHub): void {
    this.leave(port)
    if (message.type === 'close') return

    let stream = this.streams.get(message.url)
    if (!stream) {
      stream = this.open(message.url)
    } else if (message.fresh && this.mayRestart(stream)) {
      this.restart(stream)
    } else if (stream.source.readyState === OPEN && stream.hello) {
      port.postMessage({ type: 'event', name: 'hello', data: this.replay(stream.hello) })
    }
    stream.ports.add(port)
    this.joined.set(port, stream)
  }

  /** A port stops listening; a stream no tab listens to is closed. */
  private leave(port: Port): void {
    const stream = this.joined.get(port)
    if (!stream) return
    this.joined.delete(port)
    stream.ports.delete(port)
    if (stream.ports.size === 0) {
      stream.source.close()
      this.streams.delete(stream.url)
    }
  }

  private mayRestart(stream: Stream): boolean {
    const state = stream.source.readyState
    if (state === CLOSED) return true
    return state === OPEN && this.now() - stream.openedAt >= RESTART_AFTER_MS
  }

  private open(url: string): Stream {
    const stream: Stream = {
      url,
      source: this.createSource(url),
      openedAt: this.now(),
      ports: new Set(),
    }
    this.wire(stream)
    this.streams.set(url, stream)
    return stream
  }

  private restart(stream: Stream): void {
    stream.source.onerror = null
    stream.source.close()
    stream.hello = undefined
    // The tabs drop the stream as they would after a network blip; the new hello brings them back.
    this.broadcast(stream, { type: 'error', readyState: CONNECTING })
    stream.source = this.createSource(stream.url)
    stream.openedAt = this.now()
    this.wire(stream)
  }

  private wire(stream: Stream): void {
    const source = stream.source
    for (const name of EVENT_NAMES) {
      source.addEventListener(name, (event) => {
        if (stream.source !== source) return // a stream that was restarted since
        if (name === 'hello') stream.hello = { data: event.data, at: this.now() }
        this.broadcast(stream, { type: 'event', name, data: event.data })
      })
    }
    source.onerror = () => {
      if (stream.source !== source) return
      stream.hello = undefined
      this.broadcast(stream, { type: 'error', readyState: source.readyState })
    }
  }

  private broadcast(stream: Stream, message: FromHub): void {
    stream.ports.forEach((port) => port.postMessage(message))
  }

  /** The hello as if it had just arrived: its server time moved on by the time it was kept. */
  private replay(hello: { data: string; at: number }): string {
    try {
      const parsed = JSON.parse(hello.data) as { server_time?: unknown }
      if (typeof parsed.server_time !== 'string') return hello.data
      const serverTime = Date.parse(parsed.server_time)
      if (Number.isNaN(serverTime)) return hello.data
      const now = new Date(serverTime + (this.now() - hello.at)).toISOString()
      return JSON.stringify({ ...parsed, server_time: now })
    } catch {
      return hello.data
    }
  }
}
