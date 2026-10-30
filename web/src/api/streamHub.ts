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

/**
 * Tab → hub. `id` names the tab's current stream object: a tab replaces it on every reconnect,
 * and the hub tags what it sends with the id it was meant for, so a message still in flight for
 * the old one is dropped instead of being taken for news about the new one.
 * `fresh`: the tab found the stream dead or stale and asks for a new connection.
 */
export type ToHub =
  { type: 'open'; id: number; url: string; fresh: boolean } | { type: 'close'; id: number }

/** Hub → tab: a server event, or the stream's state after an error. */
export type FromHub =
  | { type: 'event'; id: number; name: string; data: string }
  | { type: 'error'; id: number; readyState: number }

export interface Port {
  postMessage(message: FromHub): void
  onmessage: ((event: MessageEvent<ToHub>) => void) | null
  start?(): void
  /** Newer browsers fire `close` on a port whose tab went away. */
  addEventListener?(type: 'close', listener: () => void): void
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

/**
 * The server's event names (server/app/routers/events.py). An EventSource can only listen by
 * name, so a new server event must be added here too for tabs on the shared stream to get it.
 */
export const EVENT_NAMES = ['hello', 'ping', 'bid', 'sold'] as const

/** A connection still not open after this long is taken as hung, and may be replaced. */
export const CONNECT_TIMEOUT_MS = 10_000
/** Until a hello says otherwise: how often the server pings a quiet stream. */
const DEFAULT_HEARTBEAT_MS = 10_000
/**
 * An open stream that delivered anything within this many heartbeats is alive: a tab asking
 * for a fresh one missed the events itself (it was asleep, or frozen in the background), so
 * it rejoins instead of restarting the stream for every tab.
 */
const ALIVE_WITHIN_HEARTBEATS = 1.5

interface Stream {
  url: string
  source: Source
  openedAt: number
  /** When the current connection last delivered anything (hello, ping or event). */
  heardAt?: number
  heartbeatMs: number
  /** Each listening port, with the id of the tab stream it listens for. */
  ports: Map<Port, number>
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
    port.addEventListener?.('close', () => this.leave(port))
    port.start?.()
  }

  private receive(port: Port, message: ToHub): void {
    if (message.type === 'close') {
      // Only the stream object that is listening may end the port's membership.
      if (this.joined.get(port)?.ports.get(port) === message.id) this.leave(port)
      return
    }
    this.leave(port)
    let stream = this.streams.get(message.url)
    if (!stream) {
      stream = this.open(message.url)
    } else if (this.isDead(stream) || (message.fresh && this.isSilent(stream))) {
      this.restart(stream)
    } else if (stream.source.readyState === OPEN && stream.hello) {
      port.postMessage({
        type: 'event',
        id: message.id,
        name: 'hello',
        data: this.replay(stream.hello),
      })
    }
    stream.ports.set(port, message.id)
    this.joined.set(port, stream)
  }

  /** A port stops listening; a stream no tab listens to is closed. */
  private leave(port: Port): void {
    const stream = this.joined.get(port)
    if (!stream) return
    this.joined.delete(port)
    stream.ports.delete(port)
    if (stream.ports.size === 0) {
      stream.source.onerror = null
      stream.source.close()
      this.streams.delete(stream.url)
    }
  }

  /** The browser gave up on it, or it never managed to connect. */
  private isDead(stream: Stream): boolean {
    const state = stream.source.readyState
    if (state === CLOSED) return true
    return state === CONNECTING && this.now() - stream.openedAt >= CONNECT_TIMEOUT_MS
  }

  /**
   * Whether a tab's "the stream is dead" holds for everyone: it's dead, or it's open but has
   * gone quiet. While it's connecting (and not hung) a restart would only start over: the tab
   * waits for the coming hello instead, so tabs asking at the same time share one restart.
   */
  private isSilent(stream: Stream): boolean {
    if (stream.source.readyState !== OPEN) return false
    const heard = stream.heardAt ?? stream.openedAt
    return this.now() - heard >= stream.heartbeatMs * ALIVE_WITHIN_HEARTBEATS
  }

  private open(url: string): Stream {
    const stream: Stream = {
      url,
      source: this.createSource(url),
      openedAt: this.now(),
      heartbeatMs: DEFAULT_HEARTBEAT_MS,
      ports: new Map(),
    }
    this.wire(stream)
    this.streams.set(url, stream)
    return stream
  }

  private restart(stream: Stream): void {
    stream.source.onerror = null
    stream.source.close()
    stream.hello = undefined
    stream.heardAt = undefined
    // The tabs drop the stream as they would after a network blip; the new hello brings them back.
    this.broadcast(stream, (id) => ({ type: 'error', id, readyState: CONNECTING }))
    stream.source = this.createSource(stream.url)
    stream.openedAt = this.now()
    this.wire(stream)
  }

  private wire(stream: Stream): void {
    const source = stream.source
    for (const name of EVENT_NAMES) {
      source.addEventListener(name, (event) => {
        if (stream.source !== source) return // a connection that was replaced since
        stream.heardAt = this.now()
        if (name === 'hello') {
          stream.hello = { data: event.data, at: this.now() }
          stream.heartbeatMs = heartbeatOf(event.data) ?? stream.heartbeatMs
        }
        this.broadcast(stream, (id) => ({ type: 'event', id, name, data: event.data }))
      })
    }
    source.onerror = () => {
      if (stream.source !== source) return
      stream.hello = undefined
      this.broadcast(stream, (id) => ({ type: 'error', id, readyState: source.readyState }))
    }
  }

  private broadcast(stream: Stream, message: (id: number) => FromHub): void {
    stream.ports.forEach((id, port) => port.postMessage(message(id)))
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

/** The ping interval a hello announces, in ms (as liveEvents.ts reads it), if it names one. */
function heartbeatOf(data: string): number | undefined {
  try {
    const seconds = (JSON.parse(data) as { heartbeat_seconds?: unknown }).heartbeat_seconds
    if (typeof seconds !== 'number' || !(seconds > 0)) return undefined
    return Math.min(Math.max(seconds * 1000, 1_000), 600_000) // liveEvents.ts's limits
  } catch {
    return undefined
  }
}
