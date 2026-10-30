import { DEFAULT_HEARTBEAT_MS, announcedHeartbeat } from './heartbeat'

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
 * Why a tab wants a new stream: `quiet` (its watchdog heard nothing, which a tab that was asleep
 * can misjudge) or `stale` (a response came from a server the stream isn't connected to).
 */
export type Fresh = false | 'quiet' | 'stale'

/**
 * Tab → hub. `id` names the tab's current stream object: a tab replaces it on every reconnect,
 * and the hub tags what it sends with the id it was meant for, so a message still in flight for
 * the old one is dropped instead of being taken for news about the new one. `run`: the server
 * run the tab is on, so a stale report is checked against the stream's own run.
 */
export type ToHub =
  | { type: 'open'; id: number; url: string; fresh: Fresh; run?: string }
  | { type: 'close'; id: number }

/**
 * Hub → tab: a server event, the stream's state after an error, or `unavailable`: the worker
 * can't open a stream at all (no EventSource in workers), so the tab must use its own.
 */
export type FromHub =
  | { type: 'event'; id: number; name: string; data: string }
  | { type: 'error'; id: number; readyState: number }
  | { type: 'unavailable'; id: number }

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

/** A connection attempt still not open after this long is taken as hung, and may be replaced. */
export const CONNECT_TIMEOUT_MS = 10_000
/**
 * An open stream that delivered anything within this many heartbeats is alive: a tab that heard
 * nothing missed the events itself (it was asleep, or frozen in the background), so it rejoins
 * instead of restarting the stream for every tab.
 */
const ALIVE_WITHIN_HEARTBEATS = 1.5
/**
 * A stream that said hello this recently is already a new connection: tabs reporting it stale
 * at the same moment share it rather than restart it again.
 */
const JUST_CONNECTED_MS = 2_000

interface Stream {
  url: string
  source: Source
  /** When the current connection attempt began: opened, restarted, or retried by the browser. */
  attemptAt: number
  /** When the current connection last delivered anything (hello, ping or event). */
  heardAt?: number
  heartbeatMs: number
  /** Each listening port, with the id of the tab stream it listens for. */
  ports: Map<Port, number>
  /** The last hello, its server run and when it arrived: replayed to tabs that join. */
  hello?: { data: string; run?: string; at: number }
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
    // A tab rejoining its own stream keeps its place: leaving first would close the connection
    // whenever it's the only tab, only to open another.
    if (this.joined.get(port)?.url !== message.url) this.leave(port)
    this.join(port, message)
  }

  private join(port: Port, message: Extract<ToHub, { type: 'open' }>): void {
    const { id, url } = message
    let stream = this.streams.get(url)
    if (!stream) {
      stream = this.open(url)
    } else if (this.isDead(stream) || this.isRestartWanted(stream, message)) {
      if (!this.restart(stream)) stream = undefined
    } else if (stream.source.readyState === OPEN && stream.hello) {
      port.postMessage({ type: 'event', id, name: 'hello', data: this.replay(stream.hello) })
    }
    if (!stream) {
      port.postMessage({ type: 'unavailable', id })
      return
    }
    stream.ports.set(port, id)
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

  /** The browser gave up on it, or its connection attempt hung. */
  private isDead(stream: Stream): boolean {
    const state = stream.source.readyState
    if (state === CLOSED) return true
    return state === CONNECTING && this.now() - stream.attemptAt >= CONNECT_TIMEOUT_MS
  }

  /**
   * Whether a tab's reason for a new stream holds for everyone. Stale: the tab is on another
   * server run than the stream (or, if either run is unknown, the stream's hello isn't brand new).
   * Quiet: only if the stream really went quiet; otherwise the tab missed the events itself.
   * While a connection is being made (and not hung), a restart would only start it over: the
   * tab waits for the coming hello instead, so tabs asking at the same time share one restart.
   */
  private isRestartWanted(stream: Stream, { fresh, run }: { fresh: Fresh; run?: string }): boolean {
    if (!fresh || stream.source.readyState !== OPEN) return false
    if (fresh === 'stale') {
      // Open but no hello yet: a connection made just now, whatever the tab saw before it.
      if (!stream.hello) return false
      if (run && stream.hello.run) return stream.hello.run !== run
      return this.now() - stream.hello.at >= JUST_CONNECTED_MS
    }
    const heard = stream.heardAt ?? stream.attemptAt
    return this.now() - heard >= stream.heartbeatMs * ALIVE_WITHIN_HEARTBEATS
  }

  /** A new connection, or null if the worker can't make one (no EventSource in workers). */
  private connectTo(url: string): Source | null {
    try {
      return this.createSource(url)
    } catch {
      return null
    }
  }

  private open(url: string): Stream | undefined {
    const source = this.connectTo(url)
    if (!source) return undefined
    const stream: Stream = {
      url,
      source,
      attemptAt: this.now(),
      heartbeatMs: DEFAULT_HEARTBEAT_MS,
      ports: new Map(),
    }
    this.wire(stream)
    this.streams.set(url, stream)
    return stream
  }

  /** Replaces the connection for every tab; false (and every tab told) if none can be made. */
  private restart(stream: Stream): boolean {
    stream.source.onerror = null
    stream.source.close()
    stream.hello = undefined
    stream.heardAt = undefined
    const source = this.connectTo(stream.url)
    if (!source) {
      this.broadcast(stream, (id) => ({ type: 'unavailable', id }))
      stream.ports.forEach((_, port) => this.joined.delete(port))
      this.streams.delete(stream.url)
      return false
    }
    // The tabs drop the stream as they would after a network blip; the new hello brings them back.
    this.broadcast(stream, (id) => ({ type: 'error', id, readyState: CONNECTING }))
    stream.source = source
    stream.attemptAt = this.now()
    this.wire(stream)
    return true
  }

  private wire(stream: Stream): void {
    const source = stream.source
    for (const name of EVENT_NAMES) {
      source.addEventListener(name, (event) => {
        if (stream.source !== source) return // a connection that was replaced since
        stream.heardAt = this.now()
        if (name === 'hello') {
          const { run, heartbeatMs } = helloFacts(event.data)
          stream.hello = { data: event.data, run, at: this.now() }
          stream.heartbeatMs = heartbeatMs ?? stream.heartbeatMs
        }
        this.broadcast(stream, (id) => ({ type: 'event', id, name, data: event.data }))
      })
    }
    source.onerror = () => {
      if (stream.source !== source) return
      stream.hello = undefined
      // The browser retries a dropped connection itself: that's a new attempt, timed afresh.
      if (source.readyState === CONNECTING) stream.attemptAt = this.now()
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

/** What the hub needs from a hello: its server run and announced ping interval. */
function helloFacts(data: string): { run?: string; heartbeatMs?: number } {
  try {
    const hello = JSON.parse(data) as { run?: unknown; heartbeat_seconds?: unknown }
    return {
      run: typeof hello.run === 'string' ? hello.run : undefined,
      heartbeatMs: announcedHeartbeat(hello.heartbeat_seconds),
    }
  } catch {
    return {}
  }
}
