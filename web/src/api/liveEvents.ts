import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'
import { showToast } from '../components/toasts/toastStore'
import { bidderId } from '../lib/bidder'
import { formatMoney } from '../lib/format'
import { syncServerTime } from '../lib/serverClock'
import { forgetSeen } from './auctionLedger'
import { applyAuction, forgetOwnBidRefreshes } from './bidding'
import { noteDataEpoch, onReseed } from './dataEpoch'
import { streamLive } from './streamGate'
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
 * The server sends `hello` on every (re)connect. Initial reads wait for the first one
 * (subscribe, then read); after a reconnect, everything on screen is refetched.
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
        // A newer epoch resets the cache (see onReseed below), which also refetches.
        const reseeded = noteDataEpoch(epoch) === 'reseeded'
        // Initial reads waited for this hello (streamGate), so they can't have missed a bid.
        const readBeforeSubscribing = streamLive()
        if (!reseeded && readBeforeSubscribing) {
          // A reconnect, or the initial wait was capped: refetch what may have missed bids.
          void queryClient.invalidateQueries()
        }
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

    // Reseeded (learned from a hello or any response): bid counts restarted, so cached snapshots
    // and what live events showed would wrongly look newer than fresh data. Drop both.
    const stopWatchingReseeds = onReseed(() => {
      forgetSeen()
      forgetOwnBidRefreshes() // bid ids restart too: an old id must not suppress a new refresh
      void queryClient.resetQueries()
    })

    connect()
    return () => {
      stopWatchingReseeds()
      clearTimeout(retry)
      source?.close()
    }
  }, [queryClient])
}
