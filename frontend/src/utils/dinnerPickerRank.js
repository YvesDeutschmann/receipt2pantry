/** Preferred meal slot for local hour (05–10 breakfast, 11–15 lunch, else dinner). */
export function preferredMealTypeForHour(hour) {
  if (hour >= 5 && hour <= 10) return 'breakfast'
  if (hour >= 11 && hour <= 15) return 'lunch'
  return 'dinner'
}

const MEAL_TITLE = {
  breakfast: "What's for Breakfast?",
  lunch: "What's for Lunch?",
  dinner: "What's for Dinner?",
}

export const SKIP_LABEL = 'Not now'

/** Time-of-day page title for cook picker and nav. */
export function whatsForMealTitle(hour = new Date().getHours()) {
  const meal = preferredMealTypeForHour(hour)
  return MEAL_TITLE[meal] || MEAL_TITLE.dinner
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

const SHELF_BANDS = [
  { shelfKey: 'use_soon_shelf', tier: 'use_soon' },
  { shelfKey: 'cook_tonight', tier: 'cook_tonight' },
  { shelfKey: 'probably_have', tier: 'probably_have' },
  { shelfKey: 'check_first', tier: 'check_first' },
]

/**
 * Flatten four shelves into one ranked list. use_soon copy wins on key collision.
 * @param {object} payload - normalized suggestions payload
 * @param {number} hour
 */
export function flattenCookDeck(payload, hour = new Date().getHours()) {
  const src = payload || {}
  const seen = new Set()
  const merged = []

  for (const { shelfKey, tier } of SHELF_BANDS) {
    const rows = src[shelfKey] || []
    let items = rows
    if (tier !== 'use_soon') {
      items = rows.filter((r) => {
        const key = suggestionCardKey(r)
        if (!key || seen.has(key)) return false
        return true
      })
    }

    const withTier = items.map((r) => ({
      ...r,
      tier: r.tier || tier,
    }))

    const ranked = rankCookTonight(withTier, hour)
    for (const card of ranked) {
      const key = suggestionCardKey(card)
      if (key) seen.add(key)
      merged.push(card)
    }
  }

  return merged
}

/**
 * Window over flattened deck: all use_soon rows, then fill to limit from the rest.
 * use_soon never loses a slot to the cap.
 */
export function windowCookDeck(flattened, limit = 8) {
  const list = flattened || []
  const useSoon = list.filter((r) => (r.tier || '') === 'use_soon')
  const rest = list.filter((r) => (r.tier || '') !== 'use_soon')
  const slotsForRest = Math.max(0, limit - useSoon.length)
  return [...useSoon, ...rest.slice(0, slotsForRest)]
}

/** True when any shelf has cards. */
export function hasAnySuggestions(payload) {
  if (!payload) return false
  return SHELF_BANDS.some(({ shelfKey }) => (payload[shelfKey] || []).length > 0)
}

/** Clamp deck index after payload or visible length changes. */
export function clampDeckIndex(index, visibleLength) {
  if (visibleLength <= 0) return 0
  return Math.min(Math.max(0, index), visibleLength - 1)
}

/**
 * Index after skip: prefer same slot (next card slides in), else clamp.
 * @param {object} opts
 * @param {number} opts.index
 * @param {string} opts.nextKey - suggestionCardKey of card at index+1 before remove
 * @param {object[]} opts.newVisible
 */
export function computeIndexAfterSkip({ index, nextKey, newVisible }) {
  if (!newVisible?.length) return 0
  if (nextKey) {
    const found = newVisible.findIndex((r) => suggestionCardKey(r) === nextKey)
    if (found >= 0) return found
  }
  return clampDeckIndex(index, newVisible.length)
}
