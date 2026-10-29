import {
  keepPreviousData,
  replaceEqualDeep,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { withNewestSeen } from './auctionLedger'
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

/** The newer of a fresh read and its cached copy, then brought up to what live events showed. */
const newest = <T extends VehicleSummary>(fresh: T, cached: T | undefined): T =>
  withNewestSeen(cached && cached.auction.bid_count > fresh.auction.bid_count ? cached : fresh)

/**
 * A read is a snapshot from when it was answered; a live bid can land meanwhile — even before
 * the first read of a page arrives. Reads therefore never replace a newer auction (by
 * bid_count), whether it's in the cache or only in the ledger of what live events showed.
 */
export function keepNewerAuctions(oldData: unknown, newData: unknown): unknown {
  if (!newData) return newData
  const previous = oldData as Cached | undefined
  const next = newData as Cached
  let merged: Cached
  if (Array.isArray(next)) {
    const byId = new Map(((previous ?? []) as VehicleSummary[]).map((item) => [item.id, item]))
    merged = next.map((item) => newest(item, byId.get(item.id)))
  } else if ('items' in next) {
    const items = (previous as VehicleList | undefined)?.items ?? []
    const byId = new Map(items.map((item) => [item.id, item]))
    merged = { ...next, items: next.items.map((item) => newest(item, byId.get(item.id))) }
  } else {
    merged = newest(next, previous as VehicleDetail | undefined)
  }
  return oldData ? replaceEqualDeep(oldData, merged) : merged
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

/**
 * Apply `update` to this vehicle wherever it is cached: inventory pages, its detail, My bids and
 * the watchlist. When `update` returns the vehicle unchanged, nothing is written — an updater
 * returning `undefined` is what tells TanStack Query to skip the write and the re-render.
 */
export function updateCachedVehicle(
  queryClient: QueryClient,
  vehicleId: string,
  update: <T extends VehicleSummary>(vehicle: T) => T,
): void {
  const patch = <T extends VehicleSummary>(items: T[]): T[] | undefined => {
    let changed = false
    const next = items.map((item) => {
      if (item.id !== vehicleId) return item
      const updated = update(item)
      changed ||= updated !== item
      return updated
    })
    return changed ? next : undefined
  }
  queryClient.setQueriesData<VehicleList>({ queryKey: queryKeys.inventoryAll }, (list) => {
    const items = list && patch(list.items)
    return items && { ...list, items }
  })
  queryClient.setQueryData<VehicleDetail>(queryKeys.vehicle(vehicleId), (detail) => {
    const updated = detail && update(detail)
    return updated === detail ? undefined : updated
  })
  queryClient.setQueryData<MyBid[]>(queryKeys.myBids, (bids) => bids && patch(bids))
  queryClient.setQueryData<VehicleSummary[]>(
    queryKeys.watchlist,
    (watched) => watched && patch(watched),
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
  // Toggles still pending (this one included): for one car, or for any car.
  const pendingToggles = (vehicleId?: string) =>
    queryClient
      .getMutationCache()
      .findAll({ mutationKey: ['watchlist'], status: 'pending' })
      .filter(
        (mutation) =>
          vehicleId === undefined ||
          (mutation.state.variables as { vehicleId: string } | undefined)?.vehicleId === vehicleId,
      ).length
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
      // A later click on this car already set the flag the buyer wants; don't revert over it.
      if (pendingToggles(vehicleId) > 1) return
      updateCachedVehicle(queryClient, vehicleId, (vehicle) => ({
        ...vehicle,
        watching: !watching,
      }))
    },
    // The server is the source of truth; this also re-runs anything cancelled above and updates
    // what the "Watching" filter and My bids contain. Only the last queued toggle does it: a
    // refetch between two toggles would flip the star back while the second is pending.
    onSettled: () =>
      pendingToggles() > 1 ? undefined : queryClient.invalidateQueries(showsWatching),
  })
}
