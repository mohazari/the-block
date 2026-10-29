import type { VehicleSummary } from '../api/types'

export function vehicleName(vehicle: Pick<VehicleSummary, 'year' | 'make' | 'model'>): string {
  return `${vehicle.year} ${vehicle.make} ${vehicle.model}`
}
