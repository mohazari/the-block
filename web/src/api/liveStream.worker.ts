/**
 * The SharedWorker every tab of the app connects to: it holds the one live stream (streamHub.ts).
 * It lives as long as any tab is open.
 */
import { StreamHub } from './streamHub'

const hub = new StreamHub((url) => new EventSource(url))

// The DOM typings don't describe a SharedWorker's global scope; this is the one part used.
const scope = self as unknown as { onconnect: ((event: MessageEvent) => void) | null }
scope.onconnect = (event) => {
  const port = event.ports[0]
  if (port) hub.connect(port)
}
