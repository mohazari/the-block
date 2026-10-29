import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { resetDataEpoch } from '../api/dataEpoch'
import { resetConnection } from '../api/liveEvents'
import { openStreamGate, resetStreamGate } from '../api/streamGate'
import { clearToasts } from '../components/toasts/toastStore'
import { resetServerClock } from '../lib/serverClock'
import { FakeEventSource } from './fakeEventSource'

beforeEach(() => {
  // Most tests don't drive the live stream: let reads through. Gate tests reset it themselves.
  resetStreamGate()
  openStreamGate()
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

// Vitest globals are off, so Testing Library can't register its own cleanup. Reset every piece
// of global state a test can touch so tests never depend on order.
afterEach(() => {
  cleanup()
  localStorage.clear()
  document.documentElement.dataset.theme = 'light'
  resetServerClock()
  resetConnection()
  resetDataEpoch()
  clearToasts()
})
