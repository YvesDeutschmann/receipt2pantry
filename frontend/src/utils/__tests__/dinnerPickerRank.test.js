import { describe, expect, it } from 'vitest'
import {
  capCookTonight,
  clampDeckIndex,
  computeIndexAfterSkip,
  flattenCookDeck,
  preferredMealTypeForHour,
  rankCookTonight,
  SKIP_LABEL,
  suggestionCardKey,
  whatsForMealTitle,
  windowCookDeck,
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

  it('whatsForMealTitle matches hour', () => {
    expect(whatsForMealTitle(8)).toBe("What's for Breakfast?")
    expect(whatsForMealTitle(12)).toBe("What's for Lunch?")
    expect(whatsForMealTitle(18)).toBe("What's for Dinner?")
  })

  it('SKIP_LABEL is Not now', () => {
    expect(SKIP_LABEL).toBe('Not now')
  })

  it('FLATTEN_PREFERS_USE_SOON_COPY_ON_COLLISION', () => {
    const payload = {
      use_soon_shelf: [
        {
          id: '1',
          pool_suggestion_id: 'pool-1',
          title: 'Use Soon Soup',
          tier: 'use_soon',
          ingredient_flags: [{ is_use_soon: true, ingredient_name: 'spinach' }],
        },
      ],
      cook_tonight: [
        { id: '1', pool_suggestion_id: 'pool-1', title: 'Plain Soup', score: 0.9 },
      ],
      probably_have: [],
      check_first: [],
    }
    const flat = flattenCookDeck(payload, 18)
    expect(flat).toHaveLength(1)
    expect(flat[0].title).toBe('Use Soon Soup')
    expect(flat[0].tier).toBe('use_soon')
  })

  it('WINDOW_PROTECTS_USE_SOON_SLOTS', () => {
    const flat = [
      { id: 'u1', tier: 'use_soon', title: 'A' },
      { id: 'u2', tier: 'use_soon', title: 'B' },
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `c${i}`,
        tier: 'cook_tonight',
        title: `C${i}`,
      })),
    ]
    const visible = windowCookDeck(flat, 8)
    expect(visible).toHaveLength(8)
    expect(visible[0].tier).toBe('use_soon')
    expect(visible[1].tier).toBe('use_soon')
    expect(visible.filter((c) => c.tier === 'use_soon')).toHaveLength(2)
    expect(visible.filter((c) => c.tier === 'cook_tonight')).toHaveLength(6)
  })

  it('SKIP_ADVANCES_TO_PEEK_NOT_INDEX_ZERO', () => {
    const newVisible = [
      { id: '2', title: 'B' },
      { id: '3', title: 'C' },
    ]
    const idx = computeIndexAfterSkip({
      index: 0,
      nextKey: '2',
      newVisible,
    })
    expect(idx).toBe(0)
    expect(newVisible[idx].title).toBe('B')
  })

  it('SKIP_LAST_OF_WINDOW_SHOWS_TAIL_CARD', () => {
    const newVisible = [{ id: 'tail', title: 'Tail' }]
    const idx = computeIndexAfterSkip({
      index: 7,
      nextKey: null,
      newVisible,
    })
    expect(idx).toBe(0)
    expect(newVisible[idx].title).toBe('Tail')
  })

  it('clampDeckIndex stays in range', () => {
    expect(clampDeckIndex(5, 3)).toBe(2)
    expect(clampDeckIndex(-1, 3)).toBe(0)
    expect(clampDeckIndex(0, 0)).toBe(0)
  })
})
