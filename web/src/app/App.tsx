import { useState } from 'react'
// From react-router/dom: the DOM build supports flushSync (synchronous URL-driven inputs).
import { RouterProvider } from 'react-router/dom'
import { AppProviders } from './AppProviders'
import { createQueryClient } from './queryClient'
import { createRouter } from './router'

export function App() {
  const [queryClient] = useState(createQueryClient)
  const [router] = useState(createRouter)

  return (
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  )
}
