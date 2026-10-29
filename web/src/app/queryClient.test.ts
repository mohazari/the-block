import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { createQueryClient } from './queryClient'

const retry = createQueryClient().getDefaultOptions().queries!.retry as (
  failures: number,
  error: unknown,
) => boolean

describe('query retries', () => {
  it('does not retry client errors that cannot change', () => {
    expect(retry(0, new ApiError(404, 'vehicle_not_found', ''))).toBe(false)
    expect(retry(0, new ApiError(422, 'invalid_request', ''))).toBe(false)
  })

  it('retries timeouts, rate limits, server and network errors', () => {
    for (const status of [0, 408, 429, 503])
      expect(retry(0, new ApiError(status, 'x', ''))).toBe(true)
    expect(retry(2, new ApiError(503, 'x', ''))).toBe(false)
  })
})
