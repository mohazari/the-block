import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '../api/client'

/**
 * Most 4xx won't change on retry (bad filter, unknown vehicle). Timeouts, rate limits, 5xx and
 * network blips might.
 */
function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Live events keep visible data fresh; refetches mostly cover reconnects and focus.
        staleTime: 15_000,
        retry: (failures, error) => failures < 2 && isRetryable(error),
        retryDelay: (attempt, error) =>
          error instanceof ApiError && error.retryAfterSeconds
            ? error.retryAfterSeconds * 1000
            : Math.min(1000 * 2 ** attempt, 8000),
      },
    },
  })
}
