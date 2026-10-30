import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { bidderId } from '../lib/bidder'
import { ApiError, api, send } from './client'
import type { LaneMessage } from './schema'
import type {
  LaneModel,
  LaneProblem,
  LaneReply,
  LaneSignIn,
  LaneStatus,
  LaneStep,
  LaneText,
} from './types'

export const laneKeys = {
  status: ['lane', 'status'] as const,
  models: ['lane', 'models'] as const,
}

/** Whether Lane can run and is signed in. Polled while a browser sign-in is under way. */
export function useLaneStatus(enabled: boolean) {
  return useQuery({
    queryKey: laneKeys.status,
    queryFn: ({ signal }) => api<LaneStatus>('/lane/status', { signal }),
    enabled,
    refetchInterval: (query) => (query.state.data?.signing_in ? 2000 : false),
  })
}

/** The models the buyer's ChatGPT plan offers, with the efforts each supports. */
export function useLaneModels(enabled: boolean) {
  return useQuery({
    queryKey: laneKeys.models,
    queryFn: ({ signal }) => api<LaneModel[]>('/lane/models', { signal }),
    enabled,
    staleTime: 10 * 60_000,
  })
}

export function useLaneSignIn() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => (await send<LaneSignIn>('/lane/sign-in', { method: 'POST' })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: laneKeys.status }),
  })
}

export function useLaneCancelSignIn() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => send('/lane/sign-in/cancel', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: laneKeys.status }),
  })
}

export function useLaneSignOut() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => send('/lane/sign-out', { method: 'POST' }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: laneKeys.models })
      return queryClient.invalidateQueries({ queryKey: laneKeys.status })
    },
  })
}

export function stopLane(conversationId: string): Promise<unknown> {
  return send(`/lane/conversations/${conversationId}/stop`, { method: 'POST' })
}

export type LaneEvent = LaneStep | LaneText | LaneReply | LaneProblem

/**
 * Ask Lane something and hand each event to `onEvent` as it streams: `step` and `text` while
 * Lane works, then one `reply` or `problem`. EventSource can't POST, so this reads the
 * event stream from fetch. Throws ApiError if the request itself is refused.
 */
export async function streamLaneReply(
  message: LaneMessage,
  onEvent: (event: LaneEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response
  try {
    response = await fetch('/api/lane/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bidder-Id': bidderId() },
      body: JSON.stringify(message),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'network_error', "Can't reach The Block. Check your connection.")
  }
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => undefined)) as
      { error?: { code?: string; message?: string } } | undefined
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'http_error',
      payload?.error?.message ?? `Request failed (${response.status}).`,
    )
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (data) onEvent(JSON.parse(data) as LaneEvent)
    }
  }
}
