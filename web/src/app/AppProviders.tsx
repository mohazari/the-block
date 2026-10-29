import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react'
import type { ReactNode } from 'react'

interface Props {
  queryClient: QueryClient
  children: ReactNode
  /** Tests pass "always" so nothing waits on animations. */
  reducedMotion?: 'user' | 'always'
}

/** Every app-wide provider, shared by the app and the tests so they can't drift apart. */
export function AppProviders({ queryClient, children, reducedMotion = 'user' }: Props) {
  return (
    <QueryClientProvider client={queryClient}>
      {/* `strict` + the `m` component keeps Motion's bundle to the DOM animation features used.
          reducedMotion="user" honours the OS "reduce motion" setting everywhere. */}
      <LazyMotion features={domAnimation} strict>
        <MotionConfig reducedMotion={reducedMotion}>{children}</MotionConfig>
      </LazyMotion>
    </QueryClientProvider>
  )
}
