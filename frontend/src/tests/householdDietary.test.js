import { describe, it, expect } from 'vitest'
import {
  buildEffectiveDietaryCodes,
  dietaryAdditionsOnly,
  dietaryHasShrink,
} from '../utils/householdDietary'

describe('householdDietary utils', () => {
  it('buildEffectiveDietaryCodes_noRestrictions', () => {
    expect(buildEffectiveDietaryCodes(['peanuts'], '', true)).toEqual([])
  })

  it('buildEffectiveDietaryCodes_with_other', () => {
    expect(buildEffectiveDietaryCodes([], 'FODMAP', false)).toEqual(['other'])
  })

  it('dietaryAdditionsOnly', () => {
    expect(dietaryAdditionsOnly(['peanuts'], ['peanuts', 'shellfish'])).toEqual(['shellfish'])
  })

  it('dietaryHasShrink', () => {
    expect(dietaryHasShrink(['peanuts', 'dairy'], ['peanuts'])).toBe(true)
    expect(dietaryHasShrink(['peanuts'], ['peanuts', 'dairy'])).toBe(false)
  })
})
