import { bidderId } from '../lib/bidder'
import { syncServerTime } from '../lib/serverClock'
import { noteDataEpoch } from './dataEpoch'
import type { AuctionSnapshot } from './types'

/** The server's error envelope: `{"error": {"code", "message", ...details}}`. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  /** Fresh auction state sent with bid rejections, so the UI can recover in place. */
  readonly auction?: AuctionSnapshot
  readonly retryAfterSeconds?: number

  constructor(
    status: number,
    code: string,
    message: string,
    auction?: AuctionSnapshot,
    retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.auction = auction
    this.retryAfterSeconds = retryAfterSeconds
  }
}

type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[]

/** Repeats keys for arrays (`?make=Ford&make=BMW`) and drops empty values. */
export function toSearchParams(query: Record<string, QueryValue>): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') continue
    if (Array.isArray(value)) value.forEach((item) => params.append(key, String(item)))
    else params.append(key, String(value))
  }
  return params
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  query?: Record<string, QueryValue>
  body?: unknown
  idempotencyKey?: string
  signal?: AbortSignal
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', query, body, idempotencyKey, signal } = options
  const search = query ? `?${toSearchParams(query)}` : ''
  const headers: Record<string, string> = { 'X-Bidder-Id': bidderId() }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  const sentAt = Date.now()
  let response: Response
  try {
    response = await fetch(`/api${path}${search}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'network_error', "Can't reach The Block. Check your connection.")
  }

  const receivedAt = Date.now()
  noteDataEpoch(response.headers.get('X-Data-Epoch'))
  if (response.status === 204) return undefined as T
  const payload: unknown = await response.json().catch(() => undefined)

  if (!response.ok) {
    const error = (payload as { error?: Record<string, unknown> } | null)?.error
    const retryAfter = Number(response.headers.get('Retry-After'))
    throw new ApiError(
      response.status,
      typeof error?.code === 'string' ? error.code : 'http_error',
      typeof error?.message === 'string' ? error.message : `Request failed (${response.status}).`,
      error?.auction as AuctionSnapshot | undefined,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    )
  }

  if (payload === undefined) {
    // e.g. an HTML page from a proxy or captive portal: fail loudly rather than return garbage.
    throw new ApiError(response.status, 'bad_response', 'The server sent an unexpected response.')
  }
  const serverTime = (payload as { server_time?: unknown } | null)?.server_time
  if (typeof serverTime === 'string') syncServerTime(serverTime, sentAt, receivedAt)
  return payload as T
}
