import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { resetServerClock } from '../lib/serverClock'

// Vitest globals are off, so Testing Library can't register its own cleanup. Reset every piece
// of global state a test can touch so tests never depend on order.
afterEach(() => {
  cleanup()
  localStorage.clear()
  document.documentElement.dataset.theme = 'light'
  resetServerClock()
})
