import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import RecipeDetailModal from '../components/RecipeDetailModal'

const { getIngredientSubstitutions } = vi.hoisted(() => ({
  getIngredientSubstitutions: vi.fn(),
}))

vi.mock('../services/apiClient', () => ({
  api: {
    getIngredientSubstitutions,
    depletePantryItem: vi.fn(),
    restorePantryItem: vi.fn(),
  },
}))

vi.mock('../hooks/useMediaQuery', () => ({
  useMediaQuery: () => false,
}))

const USER_ID = 'user-1'

const emptyPantry = {
  grouped: [],
}

const butterPantry = {
  grouped: [
    {
      base_ingredient: 'butter',
      variants: [{ id: 'v-1', normalized_name: 'butter', base_ingredient: 'butter' }],
    },
  ],
}

function recipeWithIngredients(ingredients) {
  return {
    id: 1,
    title: 'Test Recipe',
    extendedIngredients: ingredients,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getIngredientSubstitutions.mockResolvedValue({ ingredient: 'butter', substitutes: [] })
})

describe('RecipeDetailModal substitution hints', () => {
  it('RECIPE_DETAIL_SUBSTITUTION_HINT_SHOWN_FOR_UNMATCHED', async () => {
    getIngredientSubstitutions.mockResolvedValue({
      ingredient: 'butter',
      substitutes: [{ substitute: 'margarine', substitution_type: 'ingredient' }],
    })

    render(
      <RecipeDetailModal
        isOpen
        onClose={vi.fn()}
        recipe={recipeWithIngredients([{ name: 'butter', original: '2 tbsp butter' }])}
        userId={USER_ID}
        pantryData={emptyPantry}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/\(swap: margarine\)/i)).toBeInTheDocument()
    })
    expect(getIngredientSubstitutions).toHaveBeenCalledWith(USER_ID, 'butter')
  })

  it('RECIPE_DETAIL_NO_HINT_WHEN_MATCHED_IN_PANTRY', async () => {
    render(
      <RecipeDetailModal
        isOpen
        onClose={vi.fn()}
        recipe={recipeWithIngredients([{ name: 'butter', original: '2 tbsp butter' }])}
        userId={USER_ID}
        pantryData={butterPantry}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Out' })).toBeInTheDocument()
    })
    expect(getIngredientSubstitutions).not.toHaveBeenCalled()
    expect(screen.queryByText(/\(swap:/i)).not.toBeInTheDocument()
  })

  it('RECIPE_DETAIL_NO_HINT_WHEN_API_RETURNS_EMPTY', async () => {
    getIngredientSubstitutions.mockResolvedValue({ ingredient: 'butter', substitutes: [] })

    render(
      <RecipeDetailModal
        isOpen
        onClose={vi.fn()}
        recipe={recipeWithIngredients([{ name: 'butter', original: '2 tbsp butter' }])}
        userId={USER_ID}
        pantryData={emptyPantry}
      />
    )

    await waitFor(() => {
      expect(getIngredientSubstitutions).toHaveBeenCalled()
    })
    expect(screen.queryByText(/\(swap:/i)).not.toBeInTheDocument()
  })

  it('RECIPE_DETAIL_NO_HINT_WHEN_NO_PANTRY_DATA', async () => {
    render(
      <RecipeDetailModal
        isOpen
        onClose={vi.fn()}
        recipe={recipeWithIngredients([{ name: 'butter', original: '2 tbsp butter' }])}
        userId={USER_ID}
        pantryData={null}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('2 tbsp butter')).toBeInTheDocument()
    })
    expect(getIngredientSubstitutions).not.toHaveBeenCalled()
    expect(screen.queryByText(/\(swap:/i)).not.toBeInTheDocument()
  })

  it('RECIPE_DETAIL_HINT_CLEARED_ON_CLOSE', async () => {
    getIngredientSubstitutions.mockResolvedValue({
      ingredient: 'butter',
      substitutes: [{ substitute: 'margarine', substitution_type: 'ingredient' }],
    })

    const { rerender } = render(
      <RecipeDetailModal
        isOpen
        onClose={vi.fn()}
        recipe={recipeWithIngredients([{ name: 'butter', original: '2 tbsp butter' }])}
        userId={USER_ID}
        pantryData={emptyPantry}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/\(swap: margarine\)/i)).toBeInTheDocument()
    })

    rerender(
      <RecipeDetailModal
        isOpen={false}
        onClose={vi.fn()}
        recipe={recipeWithIngredients([{ name: 'butter', original: '2 tbsp butter' }])}
        userId={USER_ID}
        pantryData={emptyPantry}
      />
    )

    getIngredientSubstitutions.mockResolvedValue({
      ingredient: 'saffron',
      substitutes: [{ substitute: 'turmeric', substitution_type: 'ingredient' }],
    })

    rerender(
      <RecipeDetailModal
        isOpen
        onClose={vi.fn()}
        recipe={recipeWithIngredients([{ name: 'saffron', original: '1 pinch saffron' }])}
        userId={USER_ID}
        pantryData={emptyPantry}
      />
    )

    expect(screen.queryByText(/\(swap: margarine\)/i)).not.toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/\(swap: turmeric\)/i)).toBeInTheDocument()
    })
  })

  it('RECIPE_DETAIL_API_FAILURE_SILENT', async () => {
    getIngredientSubstitutions.mockRejectedValue(new Error('network'))

    render(
      <RecipeDetailModal
        isOpen
        onClose={vi.fn()}
        recipe={recipeWithIngredients([{ name: 'butter', original: '2 tbsp butter' }])}
        userId={USER_ID}
        pantryData={emptyPantry}
      />
    )

    await waitFor(() => {
      expect(getIngredientSubstitutions).toHaveBeenCalled()
    })
    expect(screen.getByText('2 tbsp butter')).toBeInTheDocument()
    expect(screen.queryByText(/\(swap:/i)).not.toBeInTheDocument()
  })
})
