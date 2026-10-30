import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'
import { showToast } from '../components/toasts/toastStore'
import { bidderId } from '../lib/bidder'
import { formatMoney } from '../lib/format'
import { syncServerTime } from '../lib/serverClock'
import { forgetSeen } from './auctionLedger'
import { applyAuction, forgetOwnBidRefreshes } from './bidding'
import { noteHello, noteStreamDown, onReseed, onStaleStream } from './dataEpoch'
import { DEFAULT_HEARTBEAT_MS, announcedHeartbeat } from './heartbeat'
import { openEventStream } from './sharedStream'
import { streamLive } from './streamGate'
import { CLOSED, type Fresh, type Source } from './streamHub'
import type { AuctionEvent } from './types'

export type Connection = 'connecting' | 'live' | 'reconnecting'

const RECONNECT_MS = 3_000
// The hello says how often the server pings a quiet stream; three missed in a row means the
// connection died without telling us (e.g. a proxy holding it open after the server went away).
const MISSED_PINGS = 3
// A timer that fires far too late means the tab was asleep or frozen, not the stream dead:
// buffered events may still be on their way, so give them a moment first.
const WOKE_UP_LATE_MS = 5_000
const AFTER_WAKING_MS = 5_000

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
 * One app-wide subscription to /api/events, shared by all of the app's tabs (sharedStream.ts). Each bid is written straight into every cached copy
 * of that vehicle (run list, detail page, My bids), so prices move everywhere without refetching.
 * The server sends `hello` on every (re)connect. Initial reads wait for the first one
 * (subscribe, then read); after a reconnect, everything on screen is refetched.
 */
export function useAuctionEvents(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    let source: Source | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let silence: ReturnType<typeof setTimeout> | undefined
    let connectedBefore = false
    let heartbeatMs = DEFAULT_HEARTBEAT_MS

    // Why a new stream is needed: `quiet` (the watchdog heard nothing, which a sleeping tab can
    // misjudge) or `stale` (a response came from a server this stream isn't connected to).
    const reconnect = (why: Exclude<Fresh, false>) => {
      clearTimeout(silence)
      clearTimeout(retry) // a pending retry would open a second stream next to this one
      source?.close()
      noteStreamDown()
      setConnection(connectedBefore ? 'reconnecting' : 'connecting')
      connect({ fresh: why })
    }

    // Every event (and the server's ping) proves the stream is alive; silence restarts it.
    // One grace period per silent stretch: a throttled background tab's timers always fire
    // late, and must still replace a dead stream eventually.
    const expectMore = (within = heartbeatMs * MISSED_PINGS, graced = false) => {
      clearTimeout(silence)
      const due = Date.now() + within
      silence = setTimeout(() => {
        if (!graced && Date.now() - due > WOKE_UP_LATE_MS) expectMore(AFTER_WAKING_MS, true)
        else reconnect('quiet')
      }, within)
    }

    const onAuctionEvent = (message: MessageEvent<string>) => {
      expectMore()
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

    // `fresh`: why this tab wants a new stream, for the shared one to decide whether to restart
    // it for every tab or let this tab rejoin it (streamHub.ts).
    const connect = ({ fresh = false }: { fresh?: Fresh } = {}) => {
      source = openEventStream(`/api/events?bidder_id=${encodeURIComponent(bidderId())}`, {
        fresh,
      })
      expectMore()
      source.addEventListener('ping', () => expectMore())
      source.addEventListener('hello', (message) => {
        const { server_time, epoch, run, heartbeat_seconds } = JSON.parse(message.data) as {
          server_time: string
          epoch?: string
          run?: string
          heartbeat_seconds?: number
        }
        heartbeatMs = announcedHeartbeat(heartbeat_seconds) ?? heartbeatMs
        expectMore()
        syncServerTime(server_time)
        // A run with different data resets the cache (see onReseed below), which also refetches.
        // A hello naming no run (a server that doesn't track runs) is still a live stream; there
        // is just no run to follow.
        const reseeded = run && epoch != null ? noteHello(run, epoch) : false
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
        noteStreamDown()
        setConnection(connectedBefore ? 'reconnecting' : 'connecting')
        // The browser retries dropped connections itself, but gives up for good on a bad
        // response (e.g. a 502 from a proxy). Then it's on us, or the page goes quietly stale.
        if (source?.readyState === CLOSED) {
          source.close()
          clearTimeout(silence)
          retry = setTimeout(() => connect({ fresh: 'quiet' }), RECONNECT_MS)
        }
      }
    }

    // Reseeded (a new server run with different data, from a hello or a response): bid counts
    // restarted, so cached snapshots and what live events showed would wrongly look newer than
    // fresh data. Drop both.
    const stopWatchingReseeds = onReseed(() => {
      forgetSeen()
      forgetOwnBidRefreshes() // bid ids restart too: an old id must not suppress a new refresh
      void queryClient.resetQueries()
    })

    // A response came from a server this stream isn't connected to: the stream is stale.
    const stopWatchingStaleStream = onStaleStream(() => reconnect('stale'))

    connect()
    return () => {
      stopWatchingReseeds()
      stopWatchingStaleStream()
      clearTimeout(retry)
      clearTimeout(silence)
      source?.close()
      noteStreamDown()
    }
  }, [queryClient])
}
