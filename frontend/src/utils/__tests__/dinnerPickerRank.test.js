import { describe, expect, it } from 'vitest'
import {
  capCookTonight,
  preferredMealTypeForHour,
  rankCookTonight,
  suggestionCardKey,
} from '../dinnerPickerRank'

describe('dinnerPickerRank', () => {
  it('COOK_TONIGHT_RANKS_DINNER_FIRST_AT_EVENING_AND_CAPS_AT_FIVE', () => {
    const cards = [
      { id: '1', meal_type: 'breakfast', score: 0.99, title: 'Eggs' },
      { id: '2', meal_type: 'dinner', score: 0.80, title: 'Pasta' },
      { id: '3', meal_type: 'lunch', score: 0.95, title: 'Sandwich' },
      { id: '4', meal_type: 'dinner', score: 0.90, title: 'Steak' },
      { id: '5', meal_type: 'dinner', score: 0.70, title: 'Soup' },
      { id: '6', meal_type: 'breakfast', score: 0.60, title: 'Toast' },
      { id: '7', meal_type: 'dinner', score: 0.65, title: 'Salad' },
    ]
    const ranked = rankCookTonight(cards, 18)
    expect(ranked[0].meal_type).toBe('dinner')
    expect(ranked[0].title).toBe('Steak')
    const { visible, hiddenCount } = capCookTonight(cards, 5, false, 18)
    expect(visible).toHaveLength(5)
    expect(hiddenCount).toBe(2)
    expect(visible[0].meal_type).toBe('dinner')
    expect(visible.filter((c) => c.meal_type === 'dinner').length).toBeGreaterThanOrEqual(3)
  })

  it('CARD_KEY_STABLE_FOR_SAME_RECIPE_TWO_SLOTS', () => {
    expect(
      suggestionCardKey({ id: '99', pool_suggestion_id: 'uuid-lunch' })
    ).toBe('uuid-lunch')
    expect(
      suggestionCardKey({ id: '99', pool_suggestion_id: 'uuid-dinner' })
    ).toBe('uuid-dinner')
  })

  it('preferredMealTypeForHour boundaries', () => {
    expect(preferredMealTypeForHour(10)).toBe('breakfast')
    expect(preferredMealTypeForHour(11)).toBe('lunch')
    expect(preferredMealTypeForHour(16)).toBe('dinner')
  })
})
