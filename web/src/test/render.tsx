import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { createQueryClient } from '../app/queryClient'
import { routes } from '../app/router'

/** Render the real route tree at `path`, with the app's providers. */
export function renderRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const queryClient = createQueryClient()
  return {
    router,
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <LazyMotion features={domAnimation} strict>
          <MotionConfig reducedMotion="always">
            <RouterProvider router={router} />
          </MotionConfig>
        </LazyMotion>
      </QueryClientProvider>,
    ),
  }
}
