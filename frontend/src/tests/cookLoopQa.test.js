import { describe, it, expect } from 'vitest'
import {
  clientCookLoopChecks,
  compactCookLoopQaLog,
  EXPECTED_BOM_NAMES,
  isDevCookLoopRecipe,
} from '../utils/cookLoopQa'
import { buildCookIngredients } from '../utils/buildCookIngredients'

describe('cookLoopQa', () => {
  const devRecipe = {
    id: 'pool-uuid',
    recipeIdForCook: 'dev_cook_loop',
    title: '[DEV] Cook-loop pasta',
    extendedIngredients: EXPECTED_BOM_NAMES.map((name) => ({ name })),
    _fromPool: true,
  }

  it('isDevCookLoopRecipe detects dev id', () => {
    expect(isDevCookLoopRecipe(devRecipe)).toBe(true)
    expect(isDevCookLoopRecipe({ recipeIdForCook: '501' })).toBe(false)
  })

  it('clientCookLoopChecks pass for expected cook result', () => {
    const checks = clientCookLoopChecks(
      devRecipe,
      {
        touched: [
          { base_ingredient: 'pasta' },
          { base_ingredient: 'tomatoes' },
          { base_ingredient: 'olive oil' },
        ],
      },
      { pool: { breakfast: [], lunch: [], dinner: [] } }
    )
    expect(checks.every((c) => c.ok)).toBe(true)
  })

  it('compactCookLoopQaLog summarizes failures', () => {
    const line = compactCookLoopQaLog(
      {
        ok: false,
        mode: 'observe',
        checks: [{ id: 'pool_status', ok: false }],
      },
      [{ id: 'client_bom_names', ok: true }]
    )
    expect(line).toContain('mode=observe')
    expect(line).toContain('ok=false')
    expect(line).toContain('pool_status')
  })

  it('buildCookIngredients aligns with fixture BOM', () => {
    const bom = buildCookIngredients(devRecipe)
    expect(bom.map((i) => i.name)).toEqual(EXPECTED_BOM_NAMES)
  })
})
