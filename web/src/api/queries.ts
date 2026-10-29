import {
  keepPreviousData,
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

export function useInventory(query: InventoryQuery) {
  return useQuery({
    queryKey: queryKeys.inventory(query),
    queryFn: ({ signal }) => api<VehicleList>('/vehicles', { query: { ...query }, signal }),
    // Keep the current results on screen while a new filter loads, instead of flashing empty.
    placeholderData: keepPreviousData,
  })
}

export function useVehicle(id: string) {
  return useQuery({
    queryKey: queryKeys.vehicle(id),
    queryFn: ({ signal }) => api<VehicleDetail>(`/vehicles/${id}`, { signal }),
  })
}

export function useMyBids() {
  return useQuery({
    queryKey: queryKeys.myBids,
    queryFn: ({ signal }) => api<MyBid[]>('/me/bids', { signal }),
  })
}

/** Apply `update` to this vehicle wherever it is cached: every inventory page and its detail. */
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
}

/** Watch / unwatch with an optimistic toggle; rolls back if the request fails. */
export function useWatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ vehicleId, watching }: { vehicleId: string; watching: boolean }) =>
      api<void>(`/me/watchlist/${vehicleId}`, { method: watching ? 'PUT' : 'DELETE' }),
    onMutate: ({ vehicleId, watching }) => {
      updateCachedVehicle(queryClient, vehicleId, (vehicle) => ({ ...vehicle, watching }))
    },
    onError: (_error, { vehicleId, watching }) => {
      updateCachedVehicle(queryClient, vehicleId, (vehicle) => ({
        ...vehicle,
        watching: !watching,
      }))
    },
    onSettled: (_data, _error, { watching }) => {
      // Only the "Watching" filter's results actually change membership.
      if (!watching) void queryClient.invalidateQueries({ queryKey: queryKeys.inventoryAll })
    },
  })
}
