import { QueryClientProvider } from '@tanstack/react-query'
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react'
import { useState } from 'react'
import { RouterProvider } from 'react-router'
import { createQueryClient } from './queryClient'
import { createRouter } from './router'

export function App() {
  const [queryClient] = useState(createQueryClient)
  const [router] = useState(createRouter)

  return (
    <QueryClientProvider client={queryClient}>
      {/* `strict` + the `m` component keeps Motion's bundle to the DOM animation features we use.
          reducedMotion="user" honours the OS "reduce motion" setting everywhere. */}
      <LazyMotion features={domAnimation} strict>
        <MotionConfig reducedMotion="user">
          <RouterProvider router={router} />
        </MotionConfig>
      </LazyMotion>
    </QueryClientProvider>
  )
}
