/** jsdom has no EventSource. This stand-in lets tests push server events and drop connections. */
export class FakeEventSource {
  static instances: FakeEventSource[] = []
  static latest(): FakeEventSource {
    const source = FakeEventSource.instances.at(-1)
    if (!source) throw new Error('No EventSource was opened')
    return source
  }

  readonly url: string
  closed = false
  onerror: ((event: Event) => void) | null = null
  private listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }

  close(): void {
    this.closed = true
  }

  /** Deliver a server event, as `event: <type>` + `data: <json>`. */
  emit(type: string, data: unknown): void {
    const event = new MessageEvent(type, { data: JSON.stringify(data) })
    this.listeners.get(type)?.forEach((listener) => listener(event))
  }

  fail(): void {
    this.onerror?.(new Event('error'))
  }
}
