import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'
import { showToast } from '../components/toasts/toastStore'
import { bidderId } from '../lib/bidder'
import { formatMoney } from '../lib/format'
import { syncServerTime } from '../lib/serverClock'
import { applyAuction } from './bidding'
import { noteDataEpoch, onDataEpochChange } from './dataEpoch'
import type { AuctionEvent } from './types'

export type Connection = 'connecting' | 'live' | 'reconnecting'

const RECONNECT_MS = 3_000

let connection: Connection = 'connecting'
const listeners = new Set<() => void>()
function setConnection(next: Connection) {
  if (next === connection) return
  connection = next
  listeners.forEach((listener) => listener())
}

/** Test hook. */
export const resetConnection = (): void => setConnection('connecting')

export const useConnection = (): Connection =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => connection,
  )

/**
 * One app-wide subscription to /api/events. Each bid is written straight into every cached copy
 * of that vehicle (run list, detail page, My bids), so prices move everywhere without refetching.
 * The server sends `hello` on every (re)connect. Anything fetched before it may have missed
 * events, so everything on screen is refetched — on first connect too.
 */
export function useAuctionEvents(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    let source: EventSource | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let connectedBefore = false

    const onAuctionEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as AuctionEvent
      // Patches every cached copy, My bids included (see recordOwnBid for your own bids).
      applyAuction(queryClient, event.vehicle_id, event.auction, event.bid)
      if (event.outbid_you) {
        showToast({
          tone: 'outbid',
          title: `You've been outbid on the ${event.vehicle_title}`,
          body:
            event.type === 'sold'
              ? 'Another buyer bought it with Buy Now.'
              : `Current bid ${formatMoney(event.auction.current_bid ?? 0)}. Bid ${formatMoney(event.auction.min_next_bid)} to lead again.`,
          link:
            event.type === 'sold'
              ? undefined
              : { to: `/vehicles/${event.vehicle_id}`, label: 'Bid again' },
        })
      }
    }

    const connect = () => {
      source = new EventSource(`/api/events?bidder_id=${encodeURIComponent(bidderId())}`)
      source.addEventListener('hello', (message) => {
        const { server_time, epoch } = JSON.parse(message.data) as {
          server_time: string
          epoch: string
        }
        syncServerTime(server_time)
        noteDataEpoch(epoch) // a reseed resets the cache (see the subscription below)
        // Every hello, the first included: data fetched before the stream connected may have
        // missed bids committed in between (on a reconnect, while it was down).
        void queryClient.invalidateQueries()
        connectedBefore = true
        setConnection('live')
      })
      source.addEventListener('bid', onAuctionEvent)
      source.addEventListener('sold', onAuctionEvent)
      source.onerror = () => {
        setConnection(connectedBefore ? 'reconnecting' : 'connecting')
        // The browser retries dropped connections itself, but gives up for good on a bad
        // response (e.g. a 502 from a proxy). Then it's on us, or the page goes quietly stale.
        if (source?.readyState === EventSource.CLOSED) {
          source.close()
          retry = setTimeout(connect, RECONNECT_MS)
        }
      }
    }

    // The server reseeded: cached snapshots would wrongly look newer than fresh ones.
    const stopWatchingEpoch = onDataEpochChange(() => void queryClient.resetQueries())

    connect()
    return () => {
      stopWatchingEpoch()
      clearTimeout(retry)
      source?.close()
    }
  }, [queryClient])
}
