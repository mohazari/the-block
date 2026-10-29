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
      // A refetch landing after the optimistic toggle would otherwise undo it.
      await queryClient.cancelQueries({ queryKey: ['vehicles'] })
      const snapshot = queryClient.getQueriesData({ queryKey: ['vehicles'] })
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
