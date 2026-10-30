import type { Fresh, FromHub, Source, ToHub } from './streamHub'
import { CLOSED, CONNECTING, OPEN } from './streamHub'

/**
 * The tab's side of the shared live stream (see streamHub.ts): an EventSource look-alike fed by
 * the SharedWorker, so the live-update logic works the same over it. Falls back to a plain
 * EventSource where a SharedWorker isn't available or fails to start, and where the bidder id
 * isn't stored: events are personalized per bidder, so tabs may only share a stream if they
 * share the id (it lives in localStorage).
 */
export function openEventStream(url: string, { fresh = false }: { fresh?: Fresh } = {}): Source {
  const port = sharedPort()
  if (!port) return new EventSource(url)
  // One stream per tab at a time: a newer one takes this tab's place in the hub.
  const stream = new SharedStream(port, url, ++lastId)
  current = stream
  stream.join(fresh)
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

/** The worker can't serve this tab: from now on it opens its own EventSource. */
function switchToOwnStream(): void {
  port = null
  const stream = current
  current = null
  stream?.lost()
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
  readyState = CONNECTING
  onerror: ((event: Event) => void) | null = null
  readonly id: number
  private readonly url: string
  private readonly port: MessagePort
  private readonly listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>()

  constructor(port: MessagePort, url: string, id: number) {
    this.port = port
    this.url = url
    this.id = id
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }

  close(): void {
    this.readyState = CLOSED
    // Even after an error left it closed: the hub still counts this tab in until it's told.
    if (current === this) {
      current = null
      this.leave()
    }
  }

  join(fresh: Fresh): void {
    this.send({ type: 'open', id: this.id, url: this.url, fresh })
  }

  leave(): void {
    this.send({ type: 'close', id: this.id })
  }

  /** The shared connection is gone for good: the tab's retry will open its own. */
  lost(): void {
    this.readyState = CLOSED
    this.onerror?.(new Event('error'))
  }

  receive(message: Exclude<FromHub, { type: 'unavailable' }>): void {
    if (this.readyState === CLOSED) return
    if (message.type === 'event') {
      this.readyState = OPEN
      const event = new MessageEvent(message.name, { data: message.data })
      this.listeners.get(message.name)?.forEach((listener) => listener(event))
    } else {
      this.readyState = message.readyState
      this.onerror?.(new Event('error'))
    }
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
