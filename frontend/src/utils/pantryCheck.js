/**
 * Layer 2 contextual pantry check: missed ingredients from Spoonacular.
 */

const UNIVERSAL_RE =
  /(^|\s)(salt|black pepper|peppercorns|pepper)(\s|$)|\b(water|ice)\b|\b(olive oil|vegetable oil|canola oil|peanut oil|cooking oil|oil spray)\b/i

/**
 * @param {Array<{ name?: string, original?: string }>} missedIngredients
 * @returns {Array} same objects, max 3; empty if 0 or >3 after filter
 */
export function itemsForPantryCheck(missedIngredients) {
  const raw = missedIngredients || []
  const filtered = raw.filter((m) => {
    const name = String(m.name || m.original || '').trim()
    if (!name) return false
    return !UNIVERSAL_RE.test(name)
  })
  if (filtered.length === 0 || filtered.length > 3) return []
  return filtered.slice(0, 3)
}

const SESSION_DISMISS_KEY = 'meald_pantry_check_dismissals'

export function getPantryCheckSessionDismissals() {
  try {
    return parseInt(sessionStorage.getItem(SESSION_DISMISS_KEY) || '0', 10)
  } catch {
    return 0
  }
}

export function incrementPantryCheckSessionDismissals() {
  try {
    const n = getPantryCheckSessionDismissals() + 1
    sessionStorage.setItem(SESSION_DISMISS_KEY, String(n))
  } catch {
    /* ignore */
  }
}
