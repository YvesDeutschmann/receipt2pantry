/** DEV cook-loop QA helpers (paired with data/fixtures/cook_loop_sandbox.json). */

import { buildCookIngredients } from './buildCookIngredients'
import { shouldFetchRecipeDetails } from '../components/SuggestionDetailModal'

export const DEV_COOK_LOOP_RECIPE_ID = 'dev_cook_loop'
export const COOK_LOOP_QA_STORAGE_KEY = 'cook_loop_qa_last_report'

export const EXPECTED_BOM_NAMES = ['pasta', 'tomatoes', 'olive oil', 'rice vinegar']

export function isDevCookLoopRecipe(recipe) {
  const id = String(recipe?.recipeIdForCook || recipe?.id || '')
  return id === DEV_COOK_LOOP_RECIPE_ID
}

export function clientCookLoopChecks(recipe, cookResult, poolPayload) {
  const checks = []
  const bom = buildCookIngredients(recipe)
  const bomNames = bom.map((i) => i.name.toLowerCase()).sort()
  const expectedSorted = [...EXPECTED_BOM_NAMES].sort()
  checks.push({
    id: 'client_bom_names',
    ok: JSON.stringify(bomNames) === JSON.stringify(expectedSorted),
    expected: expectedSorted,
    actual: bomNames,
  })
  checks.push({
    id: 'client_no_detail_fetch',
    ok: !shouldFetchRecipeDetails(recipe),
    expected: false,
    actual: shouldFetchRecipeDetails(recipe),
  })
  const touchedBases = (cookResult?.touched || [])
    .map((t) => (t.base_ingredient || '').toLowerCase())
    .filter(Boolean)
    .sort()
  const expectedTouched = ['olive oil', 'pasta', 'tomatoes']
  checks.push({
    id: 'client_touched_bases',
    ok: JSON.stringify(touchedBases) === JSON.stringify(expectedTouched),
    expected: expectedTouched,
    actual: touchedBases,
  })
  const pool = poolPayload?.pool || {}
  const rows = [...(pool.breakfast || []), ...(pool.lunch || []), ...(pool.dinner || [])]
  const devStillVisible = rows.some((r) => String(r.recipe_id) === DEV_COOK_LOOP_RECIPE_ID)
  checks.push({
    id: 'client_dev_card_gone',
    ok: !devStillVisible,
    expected: 'dev_cook_loop absent from unused pool',
    actual: devStillVisible ? 'still present' : 'absent',
  })
  return checks
}

export function compactCookLoopQaLog(report, clientChecks = []) {
  const failed = [
    ...(report?.checks || []),
    ...clientChecks,
  ]
    .filter((c) => !c.ok)
    .map((c) => c.id)
  const mode = report?.mode || 'observe'
  const ok = failed.length === 0 && report?.ok !== false
  return `mode=${mode} ok=${ok} failed=${failed.length ? failed.join(',') : 'none'}`
}

export function stashCookLoopReport(report) {
  try {
    if (typeof sessionStorage !== 'undefined' && report) {
      sessionStorage.setItem(COOK_LOOP_QA_STORAGE_KEY, JSON.stringify(report))
    }
  } catch {
    /* ignore */
  }
}

export function loadStashedCookLoopReport() {
  try {
    if (typeof sessionStorage === 'undefined') return null
    const raw = sessionStorage.getItem(COOK_LOOP_QA_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}
