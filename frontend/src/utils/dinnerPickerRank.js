/** Preferred meal slot for local hour (05–10 breakfast, 11–15 lunch, else dinner). */
export function preferredMealTypeForHour(hour) {
  if (hour >= 5 && hour <= 10) return 'breakfast'
  if (hour >= 11 && hour <= 15) return 'lunch'
  return 'dinner'
}

function mealRank(mealType, preferred) {
  if (mealType === preferred) return 0
  if (mealType == null) return 2
  return 1
}

/**
 * Rank cook-tonight cards: preferred meal_type first, then score desc.
 * @param {object[]} cards
 * @param {number} hour - 0–23 local hour for tests
 */
export function rankCookTonight(cards, hour = new Date().getHours()) {
  const preferred = preferredMealTypeForHour(hour)
  return [...(cards || [])].sort((a, b) => {
    const mealDiff =
      mealRank(a.meal_type, preferred) - mealRank(b.meal_type, preferred)
    if (mealDiff !== 0) return mealDiff
    return (b.score || 0) - (a.score || 0)
  })
}

/** Cap visible cook-tonight rows; remainder in hidden tail. */
export function capCookTonight(cards, limit = 5, showAll = false, hour) {
  const ranked = rankCookTonight(cards, hour)
  if (showAll || ranked.length <= limit) {
    return { visible: ranked, hiddenCount: 0 }
  }
  return {
    visible: ranked.slice(0, limit),
    hiddenCount: ranked.length - limit,
  }
}

/** Stable list identity: pool row UUID when present, else recipe id. */
export function suggestionCardKey(recipe) {
  return recipe?.pool_suggestion_id || recipe?.id || ''
}
