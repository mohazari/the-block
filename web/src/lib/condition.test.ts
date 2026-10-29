import { describe, expect, it } from 'vitest'
import { conditionLight } from './condition'

const clean = { title_status: 'clean', worst_damage: null, condition_grade: 4.2 } as const

describe('conditionLight', () => {
  it('is green for a clean title with at most cosmetic damage', () => {
    expect(conditionLight(clean)).toBe('green')
    expect(conditionLight({ ...clean, worst_damage: 'cosmetic' })).toBe('green')
  })

  it('is yellow for mechanical notes or a low grade', () => {
    expect(conditionLight({ ...clean, worst_damage: 'mechanical' })).toBe('yellow')
    expect(conditionLight({ ...clean, condition_grade: 2.9 })).toBe('yellow')
  })

  it('is red for branded titles or major damage, whatever the grade', () => {
    expect(conditionLight({ ...clean, title_status: 'salvage' })).toBe('red')
    expect(conditionLight({ ...clean, title_status: 'rebuilt' })).toBe('red')
    expect(conditionLight({ ...clean, worst_damage: 'major', condition_grade: 4.8 })).toBe('red')
  })
})
