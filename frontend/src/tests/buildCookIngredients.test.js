import { describe, it, expect } from 'vitest'
import { buildCookIngredients, isStapleRecipeId, COOK_BOM_MAX } from '../utils/buildCookIngredients'

describe('buildCookIngredients', () => {
  it('R1_does_not_spread_spoonacular_amounts', () => {
    const bom = buildCookIngredients({
      extendedIngredients: [{ name: 'flour', amount: 400, unit: 'g', id: 99 }],
    })
    expect(bom).toEqual([{ name: 'flour', amount: 1, unit: 'serving' }])
    expect(Object.keys(bom[0]).sort()).toEqual(['amount', 'name', 'unit'])
  })

  it('R2_dedupes_duplicate_names', () => {
    const bom = buildCookIngredients({
      extendedIngredients: [
        { name: 'butter', amount: 2 },
        { name: 'Butter', amount: 1 },
        { name: 'salt', amount: 1 },
      ],
    })
    expect(bom).toEqual([
      { name: 'butter', amount: 1, unit: 'serving' },
      { name: 'salt', amount: 1, unit: 'serving' },
    ])
  })

  it('R2_caps_at_30_entries', () => {
    const extendedIngredients = Array.from({ length: 40 }, (_, i) => ({
      name: `item-${i}`,
    }))
    const bom = buildCookIngredients({ extendedIngredients })
    expect(bom).toHaveLength(COOK_BOM_MAX)
  })

  it('R3_drops_blank_names', () => {
    const bom = buildCookIngredients({
      extendedIngredients: [{ name: null }, { name: '  ' }, { name: 'chicken' }],
    })
    expect(bom).toEqual([{ name: 'chicken', amount: 1, unit: 'serving' }])
  })

  it('falls_back_to_ingredient_flags_when_no_extended', () => {
    const bom = buildCookIngredients({
      ingredient_flags: [{ ingredient_name: 'salt' }],
    })
    expect(bom).toEqual([{ name: 'salt', amount: 1, unit: 'serving' }])
  })

  it('returns_empty_for_staples', () => {
    expect(
      buildCookIngredients({ recipeIdForCook: 'staple_omelette', title: 'Omelette' })
    ).toEqual([])
    expect(isStapleRecipeId({ recipeIdForCook: 'staple_omelette' })).toBe(true)
  })

  it('prefers_extended_over_flags', () => {
    const bom = buildCookIngredients({
      extendedIngredients: [{ name: 'pasta' }],
      ingredient_flags: [{ ingredient_name: 'salt' }],
    })
    expect(bom).toEqual([{ name: 'pasta', amount: 1, unit: 'serving' }])
  })
})
