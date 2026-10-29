import { describe, expect, it } from 'vitest'
import { formatDuration, formatKm, formatMoney, label } from './format'

describe('format', () => {
  it('formats whole-dollar money', () => {
    expect(formatMoney(22800)).toBe('$22,800')
  })

  it('formats kilometres', () => {
    expect(formatKm(47731)).toBe('47,731 km')
  })

  it('gets more precise as a deadline approaches', () => {
    const minute = 60_000
    expect(formatDuration(2 * 86_400_000 + 4 * 3_600_000)).toBe('2d 4h')
    expect(formatDuration(3 * 3_600_000 + 12 * minute)).toBe('3h 12m')
    expect(formatDuration(4 * minute + 9_000)).toBe('4m 09s')
    expect(formatDuration(12_000)).toBe('12s')
    expect(formatDuration(-5_000)).toBe('0s')
  })

  it('turns dataset vocabulary into labels', () => {
    expect(label('gasoline')).toBe('Gasoline')
    expect(label('SUV')).toBe('SUV')
    expect(label('single-speed')).toBe('Single-speed')
    expect(label('reserve_not_met')).toBe('Reserve not met')
  })
})
