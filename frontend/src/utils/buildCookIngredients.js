const COOK_BOM_MAX = 30

/** Client-side staple detection for fetch/BOM decisions (server uses STAPLE_RECIPE_IDS). */
export function isStapleRecipeId(recipe) {
  const id = String(recipe?.recipeIdForCook || recipe?.id || '')
  return id.startsWith('staple_')
}

/**
 * Build the bill of materials for POST /pantry/cook.
 * Never spreads Spoonacular objects — only name, amount: 1, unit: 'serving'.
 */
export function buildCookIngredients(recipe) {
  if (isStapleRecipeId(recipe)) {
    return []
  }

  const seen = new Set()
  const result = []

  const addName = (rawName) => {
    const name = String(rawName ?? '').trim()
    if (!name) return
    const key = name.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    if (result.length >= COOK_BOM_MAX) return
    result.push({ name, amount: 1, unit: 'serving' })
  }

  for (const ing of recipe?.extendedIngredients || []) {
    addName(ing?.name)
  }

  if (result.length === 0) {
    for (const f of recipe?.ingredient_flags || []) {
      addName(f?.ingredient_name)
    }
  }

  return result
}

export { COOK_BOM_MAX }
