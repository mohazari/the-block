import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ApiError, api } from './client'
import { queryKeys, updateCachedVehicle } from './queries'
import type { AuctionSnapshot, BidOut, BidPlaced, VehicleDetail } from './types'

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
    onSuccess: ({ auction, bid }) => {
      applyAuction(queryClient, vehicleId, auction, bid)
      void queryClient.invalidateQueries({ queryKey: queryKeys.myBids })
    },
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
