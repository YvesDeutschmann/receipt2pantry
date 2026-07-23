import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PantryCheckSheet from '../components/PantryCheckSheet'

const { getIngredientSubstitutions, searchIngredients, quickAddPantryItem } = vi.hoisted(() => ({
  getIngredientSubstitutions: vi.fn(),
  searchIngredients: vi.fn(),
  quickAddPantryItem: vi.fn(),
}))

vi.mock('../services/apiClient', () => ({
  api: {
    getIngredientSubstitutions,
    searchIngredients,
    quickAddPantryItem,
  },
}))

vi.mock('../utils/pantryCheck', () => ({
  incrementPantryCheckSessionDismissals: vi.fn(),
}))

const USER_ID = 'user-1'

beforeEach(() => {
  vi.clearAllMocks()
  getIngredientSubstitutions.mockResolvedValue({ ingredient: 'butter', substitutes: [] })
  searchIngredients.mockResolvedValue({ results: [] })
  quickAddPantryItem.mockResolvedValue({})
})

describe('PantryCheckSheet substitution hints', () => {
  it('PANTRY_CHECK_SHEET_SUBSTITUTE_HINT_SHOWN', async () => {
    getIngredientSubstitutions.mockResolvedValue({
      ingredient: 'butter',
      substitutes: [{ substitute: 'margarine', substitution_type: 'ingredient' }],
    })

    render(
      <PantryCheckSheet
        open
        onClose={vi.fn()}
        userId={USER_ID}
        recipeTitle="Pasta"
        missedItems={[{ name: 'butter', original: '2 tbsp butter' }]}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('or: margarine')).toBeInTheDocument()
    })
    expect(getIngredientSubstitutions).toHaveBeenCalledWith(USER_ID, 'butter')
  })

  it('PANTRY_CHECK_SHEET_NO_HINT_WHEN_EMPTY_SUBSTITUTES', async () => {
    getIngredientSubstitutions.mockResolvedValue({ ingredient: 'butter', substitutes: [] })

    render(
      <PantryCheckSheet
        open
        onClose={vi.fn()}
        userId={USER_ID}
        missedItems={[{ name: 'butter', original: '2 tbsp butter' }]}
      />
    )

    await waitFor(() => {
      expect(getIngredientSubstitutions).toHaveBeenCalled()
    })
    expect(screen.queryByText(/^or:/i)).not.toBeInTheDocument()
  })

  it('PANTRY_CHECK_SHEET_API_FAILURE_SILENT', async () => {
    getIngredientSubstitutions.mockRejectedValue(new Error('network'))

    render(
      <PantryCheckSheet
        open
        onClose={vi.fn()}
        userId={USER_ID}
        missedItems={[{ name: 'butter', original: '2 tbsp butter' }]}
      />
    )

    await waitFor(() => {
      expect(getIngredientSubstitutions).toHaveBeenCalled()
    })
    expect(screen.getByText('2 tbsp butter')).toBeInTheDocument()
    expect(screen.queryByText(/^or:/i)).not.toBeInTheDocument()
  })

  it('PANTRY_CHECK_SHEET_HINT_NOT_SHOWN_WHEN_CLOSED', async () => {
    render(
      <PantryCheckSheet
        open={false}
        onClose={vi.fn()}
        userId={USER_ID}
        missedItems={[{ name: 'butter', original: '2 tbsp butter' }]}
      />
    )

    expect(getIngredientSubstitutions).not.toHaveBeenCalled()
    expect(screen.queryByText(/^or:/i)).not.toBeInTheDocument()
  })

  it('PANTRY_CHECK_SHEET_HINT_CLEARED_ON_CLOSE_AND_REOPEN', async () => {
    getIngredientSubstitutions.mockResolvedValue({
      ingredient: 'butter',
      substitutes: [{ substitute: 'margarine', substitution_type: 'ingredient' }],
    })

    const { rerender } = render(
      <PantryCheckSheet
        open
        onClose={vi.fn()}
        userId={USER_ID}
        missedItems={[{ name: 'butter', original: '2 tbsp butter' }]}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('or: margarine')).toBeInTheDocument()
    })

    rerender(
      <PantryCheckSheet
        open={false}
        onClose={vi.fn()}
        userId={USER_ID}
        missedItems={[{ name: 'butter', original: '2 tbsp butter' }]}
      />
    )

    getIngredientSubstitutions.mockResolvedValue({
      ingredient: 'saffron',
      substitutes: [{ substitute: 'turmeric', substitution_type: 'ingredient' }],
    })

    rerender(
      <PantryCheckSheet
        open
        onClose={vi.fn()}
        userId={USER_ID}
        missedItems={[{ name: 'saffron', original: '1 pinch saffron' }]}
      />
    )

    expect(screen.queryByText('or: margarine')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('or: turmeric')).toBeInTheDocument()
    })
  })

  it('PANTRY_CHECK_SHEET_SUBSTITUTE_HINT_IS_READ_ONLY', async () => {
    getIngredientSubstitutions.mockResolvedValue({
      ingredient: 'butter',
      substitutes: [{ substitute: 'margarine', substitution_type: 'ingredient' }],
    })

    render(
      <PantryCheckSheet
        open
        onClose={vi.fn()}
        userId={USER_ID}
        missedItems={[{ name: 'butter', original: '2 tbsp butter' }]}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('or: margarine')).toBeInTheDocument()
    })

    const hint = screen.getByText('or: margarine')
    expect(hint.tagName).not.toBe('BUTTON')
    expect(hint).not.toHaveAttribute('role', 'button')
    expect(hint.onclick).toBeNull()
  })
})
