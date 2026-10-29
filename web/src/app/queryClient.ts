import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '../api/client'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Live events keep visible data fresh; refetches mostly cover reconnects and focus.
        staleTime: 15_000,
        // A 4xx won't change on retry (bad filter, unknown vehicle); network blips might.
        retry: (failures, error) =>
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2,
      },
    },
  })
}
