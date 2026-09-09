import { describe, it, expect } from 'vitest'
import { pantryIngredientNamesMatch } from '../utils/pantryIngredientMatch'

describe('pantryIngredientNamesMatch', () => {
  it('matches exact names', () => {
    expect(pantryIngredientNamesMatch('pasta', 'pasta')).toBe(true)
  })

  it('matches simple plurals', () => {
    expect(pantryIngredientNamesMatch('tomato', 'tomatoes')).toBe(true)
    expect(pantryIngredientNamesMatch('onion', 'onions')).toBe(true)
    expect(pantryIngredientNamesMatch('chicken breast', 'chicken breasts')).toBe(true)
  })

  it('matches word-subset when the shorter name has two words', () => {
    expect(pantryIngredientNamesMatch('chicken breast', 'boneless chicken breast')).toBe(
      true
    )
  })

  it('does not match rice vinegar to rice', () => {
    expect(pantryIngredientNamesMatch('rice', 'rice vinegar')).toBe(false)
  })

  it('does not match ice to rice', () => {
    expect(pantryIngredientNamesMatch('rice', 'ice')).toBe(false)
  })
})
