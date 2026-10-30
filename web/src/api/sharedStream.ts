import type { Fresh, FromHub, Source, ToHub } from './streamHub'
import { CLOSED, CONNECTING, EVENT_NAMES, OPEN } from './streamHub'

/**
 * The tab's side of the shared live stream (see streamHub.ts): an EventSource look-alike fed by
 * the SharedWorker, so the live-update logic works the same over it. Falls back to a plain
 * EventSource where a SharedWorker isn't available or fails to start, and where the bidder id
 * isn't stored: events are personalized per bidder, so tabs may only share a stream if they
 * share the id (it lives in localStorage).
 */
export function openEventStream(
  url: string,
  { fresh = false, run }: { fresh?: Fresh; run?: string } = {},
): Source {
  const port = sharedPort()
  if (!port) return new EventSource(url)
  // One stream per tab at a time: a newer one takes this tab's place in the hub.
  const stream = new SharedStream(port, url, ++lastId)
  current = stream
  stream.join(fresh, run)
  return stream
}

/** The tab's port to the worker; null once it's known the tab must use its own EventSource. */
let port: MessagePort | null | undefined
let current: SharedStream | null = null
let lastId = 0

function sharedPort(): MessagePort | null {
  if (port !== undefined) return port
  port = null
  if (typeof SharedWorker !== 'function' || !storageWorks()) return port
  try {
    const worker = new SharedWorker(new URL('./liveStream.worker.ts', import.meta.url), {
      type: 'module',
      name: 'the-block-live',
    })
    // A worker script that can't load (blocked, or gone after a deploy) fails after the fact.
    // The stream reports the connection lost for good; the tab's retry then opens its own.
    worker.onerror = switchToOwnStream
    port = worker.port
    port.onmessage = (event: MessageEvent<FromHub>) => {
      // Messages for a stream this tab has since replaced are old news.
      if (event.data.id !== current?.id) return
      if (event.data.type === 'unavailable') switchToOwnStream()
      else current.receive(event.data)
    }
    port.start()
    // A closing tab says goodbye (a page can't tell the worker otherwise); a tab coming back
    // from the back/forward cache says hello again.
    window.addEventListener('pagehide', () => current?.leave())
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) current?.join(false)
    })
  } catch {
    port = null
  }
  return port
}

/** The worker can't serve this tab: from now on it opens its own EventSource, starting now. */
function switchToOwnStream(): void {
  port?.close()
  port = null
  const stream = current
  current = null
  stream?.fallBack()
}

function storageWorks(): boolean {
  try {
    localStorage.setItem('the-block:probe', '1')
    localStorage.removeItem('the-block:probe')
    return true
  } catch {
    return false
  }
}

class SharedStream implements Source {
  onerror: ((event: Event) => void) | null = null
  readonly id: number
  private state = CONNECTING
  /** Set if the worker can't serve the tab: this tab's own connection, behind the same face. */
  private own?: EventSource
  private readonly url: string
  private readonly port: MessagePort
  private readonly listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>()

  constructor(port: MessagePort, url: string, id: number) {
    this.port = port
    this.url = url
    this.id = id
  }

  get readyState(): number {
    return this.own && this.state !== CLOSED ? this.own.readyState : this.state
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }

  close(): void {
    this.state = CLOSED
    this.own?.close()
    if (current !== this) return
    current = null
    // Leave the hub only if the tab isn't reconnecting: a reconnect opens the next stream right
    // away, which takes this one's place, so the tab's connection survives if it's the only one.
    queueMicrotask(() => {
      if (current === null) this.leave()
    })
  }

  join(fresh: Fresh, run?: string): void {
    this.send({ type: 'open', id: this.id, url: this.url, fresh, run })
  }

  leave(): void {
    this.send({ type: 'close', id: this.id })
  }

  /** Carries on over the tab's own EventSource; the live-update logic doesn't notice. */
  fallBack(): void {
    if (this.state === CLOSED) return
    // The shared connection is gone: the tab shows it reconnecting until its own says hello.
    this.state = CONNECTING
    this.onerror?.(new Event('error'))
    const own = new EventSource(this.url)
    this.own = own
    for (const name of EVENT_NAMES) {
      own.addEventListener(name, (event) => this.dispatch(name, event.data))
    }
    own.onerror = () => this.onerror?.(new Event('error'))
  }

  receive(message: Exclude<FromHub, { type: 'unavailable' }>): void {
    if (this.state === CLOSED) return
    if (message.type === 'event') {
      this.state = OPEN
      this.dispatch(message.name, message.data)
    } else {
      this.state = message.readyState
      this.onerror?.(new Event('error'))
    }
  }

  private dispatch(name: string, data: string): void {
    const event = new MessageEvent(name, { data })
    this.listeners.get(name)?.forEach((listener) => listener(event))
  }

  private send(message: ToHub): void {
    try {
      this.port.postMessage(message)
    } catch {
      // The worker is gone; worker.onerror (or the tab's watchdog) takes it from here.
    }
  }
}

/** Test hook: forget the worker connection, so the next stream decides afresh. */
export function resetSharedStream(): void {
  port = undefined
  current = null
}
