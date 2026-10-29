import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'
import { showToast } from '../components/toasts/toastStore'
import { bidderId } from '../lib/bidder'
import { formatMoney } from '../lib/format'
import { syncServerTime } from '../lib/serverClock'
import { applyAuction } from './bidding'
import { queryKeys } from './queries'
import type { AuctionEvent } from './types'

export type Connection = 'connecting' | 'live' | 'reconnecting'

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
 * The server sends `hello` on every (re)connect; after the first it means "you may have missed
 * events", so everything is refetched.
 */
export function useAuctionEvents(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    const source = new EventSource(`/api/events?bidder_id=${encodeURIComponent(bidderId())}`)
    let connectedBefore = false

    source.addEventListener('hello', (message) => {
      const { server_time } = JSON.parse(message.data) as { server_time: string }
      syncServerTime(server_time)
      if (connectedBefore) void queryClient.invalidateQueries()
      connectedBefore = true
      setConnection('live')
    })

    const onAuctionEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as AuctionEvent
      applyAuction(queryClient, event.vehicle_id, event.auction, event.bid)
      if (event.outbid_you || event.bid.is_you) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.myBids })
      }
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
    source.addEventListener('bid', onAuctionEvent)
    source.addEventListener('sold', onAuctionEvent)

    // EventSource reconnects on its own; this only reflects that it's trying.
    source.onerror = () => setConnection(connectedBefore ? 'reconnecting' : 'connecting')

    return () => source.close()
  }, [queryClient])
}
