/**
 * Match a pantry base/normalized name to a recipe ingredient name.
 * Exact and inflection only — no substring includes (rice ↛ rice vinegar, ice ↛ rice).
 */
export function pantryIngredientNamesMatch(pantryName, recipeName) {
  const a = String(pantryName || '')
    .toLowerCase()
    .trim()
  const b = String(recipeName || '')
    .toLowerCase()
    .trim()
  if (!a || !b) return false
  if (a === b) return true
  if (a + 's' === b || b + 's' === a) return true
  if (a + 'es' === b || b + 'es' === a) return true

  const aWords = new Set(a.split(/\s+/).filter(Boolean))
  const bWords = new Set(b.split(/\s+/).filter(Boolean))
  const [shorter, longer] =
    aWords.size <= bWords.size ? [aWords, bWords] : [bWords, aWords]
  if (shorter.size < 2) return false
  for (const w of shorter) {
    if (!longer.has(w)) return false
  }
  return true
}

/** Find a pantry variant row matching a recipe/trigger ingredient name. */
export function findPantryVariantForIngredientName(pantryData, ingredientName) {
  if (!pantryData?.grouped || !ingredientName) return null
  const needle = String(ingredientName).trim()
  for (const g of pantryData.grouped) {
    const base = g.base_ingredient
    for (const v of g.variants || []) {
      const names = [base, v.normalized_name]
      if (names.some((n) => pantryIngredientNamesMatch(n, needle))) {
        return v
      }
    }
  }
  return null
}
