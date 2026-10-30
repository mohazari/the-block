import type { FromHub, Source, ToHub } from './streamHub'
import { CLOSED, CONNECTING, OPEN } from './streamHub'

/**
 * The tab's side of the shared live stream (see streamHub.ts): an EventSource look-alike fed by
 * the SharedWorker, so the live-update logic works the same over it. Falls back to a plain
 * EventSource where a SharedWorker isn't available (or can't start), and where the bidder id
 * isn't stored: events are personalized per bidder, so tabs may only share a stream if they
 * share the id (it lives in localStorage).
 */
export function openEventStream(url: string, { fresh = false } = {}): Source {
  const port = sharedPort()
  if (!port) return new EventSource(url)
  // One stream per tab at a time: a newer one takes this tab's place in the hub.
  const stream = new SharedStream(port)
  current = stream
  stream.send({ type: 'open', url, fresh })
  return stream
}

let port: MessagePort | null | undefined
let current: SharedStream | null = null

function sharedPort(): MessagePort | null {
  if (port !== undefined) return port
  port = null
  if (typeof SharedWorker !== 'function' || !storageWorks()) return port
  try {
    const worker = new SharedWorker(new URL('./liveStream.worker.ts', import.meta.url), {
      type: 'module',
      name: 'the-block-live',
    })
    port = worker.port
    port.onmessage = (event: MessageEvent<FromHub>) => current?.receive(event.data)
    port.start()
  } catch {
    port = null
  }
  return port
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
  private readonly listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>()
  private readonly port: MessagePort

  constructor(port: MessagePort) {
    this.port = port
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }

  close(): void {
    if (this.readyState === CLOSED) return
    this.readyState = CLOSED
    if (current === this) {
      current = null
      this.send({ type: 'close' })
    }
  }

  receive(message: FromHub): void {
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

  send(message: ToHub): void {
    this.port.postMessage(message)
  }
}

/** Test hook: forget the worker connection, so the next stream decides afresh. */
export function resetSharedStream(): void {
  port = undefined
  current = null
}
