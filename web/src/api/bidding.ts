import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ApiError, api } from './client'
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
  updateCachedVehicle(queryClient, vehicleId, (vehicle) =>
    auction.bid_count >= vehicle.auction.bid_count ? { ...vehicle, auction } : vehicle,
  )
  if (bid?.is_you) recordOwnBid(queryClient, vehicleId, bid)
  if (bid) {
    queryClient.setQueryData<VehicleDetail>(
      queryKeys.vehicle(vehicleId),
      (detail) =>
        detail && {
          ...detail,
          recent_bids: mergeBid(detail.recent_bids, bid, detail.recent_bids_limit),
        },
    )
  }
}

/**
 * Your own bid updates My bids in place (top bid, last bid time). Both the bid response and its
 * live echo come through here, so this must not trigger a refetch each time; it only fetches
 * when My bids doesn't list the car yet (e.g. a first bid placed from another tab).
 */
function recordOwnBid(queryClient: QueryClient, vehicleId: string, bid: BidOut): void {
  const bids = queryClient.getQueryData<MyBid[]>(queryKeys.myBids)
  if (!bids?.some((entry) => entry.id === vehicleId)) {
    // The response and the live echo both get here for a first bid. Whichever comes second must
    // not abort and restart the refetch the first started: it began after the bid was committed.
    void queryClient.invalidateQueries({ queryKey: queryKeys.myBids }, { cancelRefetch: false })
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

/**
 * Add a bid to the history in time order. Bids can arrive out of order (a rival's live event
 * before the response to your own), so position comes from when it was placed, not arrival.
 */
function mergeBid(bids: BidOut[], bid: BidOut, limit: number): BidOut[] {
  if (bids.some((existing) => existing.id === bid.id)) return bids
  return [bid, ...bids]
    .sort((a, b) => Date.parse(b.placed_at) - Date.parse(a.placed_at) || b.id - a.id)
    .slice(0, limit) // the server's limit, so a refetch shows the same list
}

interface PlaceBid {
  amount: number
  /** One key per confirmed attempt: a retry after a network failure can't bid twice. */
  idempotencyKey: string
}

function useAuctionMutation<V>(vehicleId: string, request: (variables: V) => Promise<BidPlaced>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: request,
    onSuccess: ({ auction, bid }) => applyAuction(queryClient, vehicleId, auction, bid),
    onError: (error) => {
      // Rejections carry the auction as it is now; show it instead of the stale view.
      if (error instanceof ApiError && error.auction) {
        applyAuction(queryClient, vehicleId, error.auction)
      }
    },
  })
}

export function usePlaceBid(vehicleId: string) {
  return useAuctionMutation(vehicleId, ({ amount, idempotencyKey }: PlaceBid) =>
    api<BidPlaced>(`/vehicles/${vehicleId}/bids`, {
      method: 'POST',
      body: { amount },
      idempotencyKey,
    }),
  )
}

export function useBuyNow(vehicleId: string) {
  return useAuctionMutation(vehicleId, ({ idempotencyKey }: { idempotencyKey: string }) =>
    api<BidPlaced>(`/vehicles/${vehicleId}/buy-now`, { method: 'POST', idempotencyKey }),
  )
}
