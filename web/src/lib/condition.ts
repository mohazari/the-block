import type { DamageSeverity } from '../api/types'

/**
 * Auction "lights", borrowed from the physical auction block where a light over the lane tells
 * buyers how a car is being sold. Derived here from title status and damage severity:
 *
 *   green   clean title, no mechanical or major damage notes
 *   yellow  announcements to read: mechanical issues, or condition grade below 3
 *   red     as-is: salvage or rebuilt title, or major damage (frame, flood, airbag, water)
 */
export type ConditionLight = 'green' | 'yellow' | 'red'

interface ConditionInput {
  title_status: string
  worst_damage: DamageSeverity | null
  condition_grade: number
}

export function conditionLight(vehicle: ConditionInput): ConditionLight {
  if (vehicle.title_status !== 'clean' || vehicle.worst_damage === 'major') return 'red'
  if (vehicle.worst_damage === 'mechanical' || vehicle.condition_grade < 3) return 'yellow'
  return 'green'
}

export const LIGHT_LABEL: Record<ConditionLight, string> = {
  green: 'Green light',
  yellow: 'Yellow light',
  red: 'Red light',
}

export const LIGHT_MEANING: Record<ConditionLight, string> = {
  green: 'Clean title, no mechanical or major damage reported.',
  yellow: 'Read the announcements: mechanical issues or a grade below 3.',
  red: 'Sold as-is: branded title or major damage (frame, flood, airbag, water).',
}
