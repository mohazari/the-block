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
  watchlist: ['me', 'watchlist'] as const,
}

type Cached = VehicleList | VehicleDetail | VehicleSummary[]

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
    const byId = new Map((previous as VehicleSummary[]).map((item) => [item.id, item]))
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

export function useWatchlist() {
  return useQuery({
    queryKey: queryKeys.watchlist,
    queryFn: ({ signal }) => api<VehicleSummary[]>('/me/watchlist', { signal }),
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
  queryClient.setQueryData<VehicleSummary[]>(queryKeys.watchlist, (watched) =>
    watched?.map((vehicle) => (vehicle.id === vehicleId ? update(vehicle) : vehicle)),
  )
}

/** Every cached query that shows a vehicle's `watching` flag. */
const showsWatching = {
  predicate: ({ queryKey }: { queryKey: readonly unknown[] }) =>
    queryKey[0] === 'vehicles' || queryKey[0] === 'me',
}

/**
 * Watch / unwatch with an optimistic toggle. A failure reverts only the `watching` flag — never
 * a whole snapshot, which would also roll back live prices that arrived meanwhile.
 */
export function useWatch() {
  const queryClient = useQueryClient()
  // Is a later toggle (another click) still queued behind this one? This one counts itself.
  const supersededLater = () => queryClient.isMutating({ mutationKey: ['watchlist'] }) > 1
  return useMutation({
    // Run toggles one after another, in click order: a quick watch-unwatch must not reach the
    // server as a PUT and DELETE racing each other.
    scope: { id: 'watchlist' },
    mutationKey: ['watchlist'],
    mutationFn: ({ vehicleId, watching }: { vehicleId: string; watching: boolean }) =>
      api<void>(`/me/watchlist/${vehicleId}`, { method: watching ? 'PUT' : 'DELETE' }),
    onMutate: async ({ vehicleId, watching }) => {
      // A refetch landing after the optimistic toggle would undo it. Whatever is cancelled here
      // is refetched in onSettled.
      await queryClient.cancelQueries(showsWatching)
      updateCachedVehicle(queryClient, vehicleId, (vehicle) => ({ ...vehicle, watching }))
    },
    onError: (_error, { vehicleId, watching }) => {
      // A later click already set the flag the buyer wants; don't revert over it.
      if (supersededLater()) return
      updateCachedVehicle(queryClient, vehicleId, (vehicle) => ({
        ...vehicle,
        watching: !watching,
      }))
    },
    // The server is the source of truth; this also re-runs anything cancelled above and updates
    // what the "Watching" filter and My bids contain. Only the last queued toggle does it: a
    // refetch between two toggles would flip the star back while the second is pending.
    onSettled: () => (supersededLater() ? undefined : queryClient.invalidateQueries(showsWatching)),
  })
}
