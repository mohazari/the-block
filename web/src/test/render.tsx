import { render } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { AppProviders } from '../app/AppProviders'
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
      <AppProviders queryClient={queryClient} reducedMotion="always">
        <RouterProvider router={router} />
      </AppProviders>,
    ),
  }
}
