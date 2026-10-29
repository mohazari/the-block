import {
  keepPreviousData,
  replaceEqualDeep,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { api } from './client'
import type { InventoryQuery, MyBid, VehicleDetail, VehicleList, VehicleSummary } from './types'

export const queryKeys = {
  inventory: (query: InventoryQuery) => ['vehicles', 'list', query] as const,
  inventoryAll: ['vehicles', 'list'] as const,
  vehicle: (id: string) => ['vehicles', 'detail', id] as const,
  myBids: ['me', 'bids'] as const,
}

type Cached = VehicleList | VehicleDetail | MyBid[]

const newerOf = <T extends VehicleSummary>(fresh: T, cached: T | undefined): T =>
  cached && cached.auction.bid_count > fresh.auction.bid_count ? cached : fresh

/**
 * A refetch is a snapshot taken when the request started; a live bid can land while it's in
 * flight. Like live events, refetched data never replaces a newer auction (by bid_count).
 */
export function keepNewerAuctions(oldData: unknown, newData: unknown): unknown {
  if (!oldData || !newData) return newData
  const previous = oldData as Cached
  const next = newData as Cached
  let merged: Cached
  if (Array.isArray(next)) {
    const byId = new Map((previous as MyBid[]).map((bid) => [bid.id, bid]))
    merged = next.map((bid) => newerOf(bid, byId.get(bid.id)))
  } else if ('items' in next) {
    const byId = new Map((previous as VehicleList).items.map((item) => [item.id, item]))
    merged = { ...next, items: next.items.map((item) => newerOf(item, byId.get(item.id))) }
  } else {
    merged = newerOf(next, previous as VehicleDetail)
  }
  return replaceEqualDeep(oldData, merged)
}

export function useInventory(query: InventoryQuery) {
  return useQuery({
    queryKey: queryKeys.inventory(query),
    queryFn: ({ signal }) => api<VehicleList>('/vehicles', { query: { ...query }, signal }),
    // Keep the current results on screen while a new filter loads, instead of flashing empty.
    placeholderData: keepPreviousData,
    structuralSharing: keepNewerAuctions,
  })
}

export function useVehicle(id: string) {
  return useQuery({
    queryKey: queryKeys.vehicle(id),
    queryFn: ({ signal }) => api<VehicleDetail>(`/vehicles/${id}`, { signal }),
    structuralSharing: keepNewerAuctions,
  })
}

export function useMyBids() {
  return useQuery({
    queryKey: queryKeys.myBids,
    queryFn: ({ signal }) => api<MyBid[]>('/me/bids', { signal }),
    structuralSharing: keepNewerAuctions,
  })
}

/** Apply `update` to this vehicle wherever it is cached: inventory pages, its detail, My bids. */
export function updateCachedVehicle(
  queryClient: QueryClient,
  vehicleId: string,
  update: <T extends VehicleSummary>(vehicle: T) => T,
): void {
  queryClient.setQueriesData<VehicleList>(
    { queryKey: queryKeys.inventoryAll },
    (list) =>
      list && {
        ...list,
        items: list.items.map((item) => (item.id === vehicleId ? update(item) : item)),
      },
  )
  queryClient.setQueryData<VehicleDetail>(
    queryKeys.vehicle(vehicleId),
    (detail) => detail && update(detail),
  )
  queryClient.setQueryData<MyBid[]>(queryKeys.myBids, (bids) =>
    bids?.map((bid) => (bid.id === vehicleId ? update(bid) : bid)),
  )
}

/** Watch / unwatch with an optimistic toggle; restores the exact previous cache on failure. */
export function useWatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ vehicleId, watching }: { vehicleId: string; watching: boolean }) =>
      api<void>(`/me/watchlist/${vehicleId}`, { method: watching ? 'PUT' : 'DELETE' }),
    onMutate: async ({ vehicleId, watching }) => {
      // Every cache updateCachedVehicle writes to: a refetch landing after the optimistic toggle
      // would otherwise undo it, and a failure must restore all of them.
      const filters = {
        predicate: ({ queryKey }: { queryKey: readonly unknown[] }) =>
          queryKey[0] === 'vehicles' || queryKey[0] === 'me',
      }
      await queryClient.cancelQueries(filters)
      const snapshot = queryClient.getQueriesData(filters)
      updateCachedVehicle(queryClient, vehicleId, (vehicle) => ({ ...vehicle, watching }))
      return { snapshot }
    },
    onError: (_error, _variables, context) => {
      context?.snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data))
    },
    // Watching or unwatching changes what the "Watching" filter contains.
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.inventoryAll }),
  })
}
