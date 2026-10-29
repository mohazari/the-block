import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { mergeBid, noteSeen } from './auctionLedger'
import { ApiError, send, type Answer } from './client'
import { queryKeys, updateCachedVehicle } from './queries'
import type { AuctionSnapshot, BidOut, BidPlaced, MyBid, VehicleDetail } from './types'

/**
 * Write an auction snapshot (and optionally a new bid) into every cached copy — unless the cache
 * already has a newer one. Snapshots arrive out of order (a live event for a rival's bid can beat
 * the response to your own), and every bid raises `bid_count`, so it orders them.
 */
export function applyAuction(
  queryClient: QueryClient,
  vehicleId: string,
  auction: AuctionSnapshot,
  bid?: BidOut,
): void {
  noteSeen(vehicleId, auction, bid)
  updateCachedVehicle(queryClient, vehicleId, (vehicle) =>
    supersedes(auction, vehicle.auction) ? { ...vehicle, auction } : vehicle,
  )
  if (bid?.is_you) recordOwnBid(queryClient, vehicleId, bid)
  if (bid) {
    queryClient.setQueryData<VehicleDetail>(queryKeys.vehicle(vehicleId), (detail) => {
      if (!detail) return undefined
      const recentBids = mergeBid(detail.recent_bids, bid, detail.recent_bids_limit)
      // A bid we already have (your own bid's live echo) leaves the cache, and the page, alone.
      // (Returning undefined skips the write; returning `detail` would still write and notify.)
      return recentBids === detail.recent_bids ? undefined : { ...detail, recent_bids: recentBids }
    })
  }
}

/**
 * Newer by bid count; at an equal count only if something differs (personalized flags can) —
 * an identical snapshot, like your own bid's live echo, must not write or re-render anything.
 */
function supersedes(next: AuctionSnapshot, current: AuctionSnapshot): boolean {
  if (next.bid_count !== current.bid_count) return next.bid_count > current.bid_count
  return (Object.keys(next) as (keyof AuctionSnapshot)[]).some((key) => next[key] !== current[key])
}

/**
 * Your own bid updates My bids in place (top bid, last bid time). Both the bid response and its
 * live echo come through here, so this must not trigger a refetch each time; it only fetches
 * when My bids doesn't list the car yet (e.g. a first bid placed from another tab).
 */
// Own bids whose My bids refresh has started: the bid response and its live echo share an id,
// so only the first of the two refreshes.
const refreshedForBid = new Set<number>()

/** After a reseed (bid ids restart), and between tests. */
export const forgetOwnBidRefreshes = (): void => refreshedForBid.clear()

function recordOwnBid(queryClient: QueryClient, vehicleId: string, bid: BidOut): void {
  const bids = queryClient.getQueryData<MyBid[]>(queryKeys.myBids)
  if (!bids?.some((entry) => entry.id === vehicleId)) {
    // My bids needs a read taken after this bid. The response and its live echo both get here
    // (after the commit); the first cancels any read already running, which may predate the
    // bid (explicitly: invalidate alone would join an in-flight initial load), and refetches.
    if (refreshedForBid.has(bid.id)) return
    refreshedForBid.add(bid.id)
    void queryClient
      .cancelQueries({ queryKey: queryKeys.myBids })
      .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.myBids }))
    return
  }
  queryClient.setQueryData<MyBid[]>(queryKeys.myBids, (entries) =>
    entries?.map((entry) =>
      entry.id === vehicleId
        ? {
            ...entry,
            my_top_bid: Math.max(entry.my_top_bid, bid.amount),
            my_last_bid_at:
              Date.parse(bid.placed_at) > Date.parse(entry.my_last_bid_at)
                ? bid.placed_at
                : entry.my_last_bid_at,
          }
        : entry,
    ),
  )
}

interface PlaceBid {
  amount: number
  /** One key per confirmed attempt: a retry after a network failure can't bid twice. */
  idempotencyKey: string
}

function useAuctionMutation<V>(
  vehicleId: string,
  request: (variables: V) => Promise<Answer<BidPlaced>>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: request,
    // The data may be reset while a bid is in flight; its snapshot could then describe other
    // data. The outcome is still shown, but only a snapshot from the cache's data enters it
    // (after a reset everything is refetched anyway).
    onSuccess: ({ data, sameData }) => {
      if (sameData) applyAuction(queryClient, vehicleId, data.auction, data.bid)
    },
    onError: (error) => {
      // Rejections carry the auction as it is now; show it instead of the stale view.
      if (error instanceof ApiError && error.auction && !error.fromOtherData) {
        applyAuction(queryClient, vehicleId, error.auction)
      }
    },
  })
}

export function usePlaceBid(vehicleId: string) {
  return useAuctionMutation(vehicleId, ({ amount, idempotencyKey }: PlaceBid) =>
    send<BidPlaced>(`/vehicles/${vehicleId}/bids`, {
      method: 'POST',
      body: { amount },
      idempotencyKey,
    }),
  )
}

export function useBuyNow(vehicleId: string) {
  return useAuctionMutation(vehicleId, ({ idempotencyKey }: { idempotencyKey: string }) =>
    send<BidPlaced>(`/vehicles/${vehicleId}/buy-now`, { method: 'POST', idempotencyKey }),
  )
}
