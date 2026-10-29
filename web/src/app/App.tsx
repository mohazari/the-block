import { useState } from 'react'
import { RouterProvider } from 'react-router'
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
