import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SuggestionDetailModal, {
  mergeRecipeDetails,
  shouldFetchRecipeDetails,
  resolveRecipeFetchId,
  hasInstructionContent,
} from '../components/SuggestionDetailModal'

const getRecipeDetails = vi.fn()

vi.mock('../services/apiClient', () => ({
  api: {
    getRecipeDetails: (...args) => getRecipeDetails(...args),
    correctPantryItem: vi.fn(() => Promise.resolve({ ok: true })),
  },
}))

vi.mock('../components/AdaptiveModal', () => ({
  default: ({ isOpen, children, title, footer }) =>
    isOpen ? (
      <div data-testid="modal">
        <h1>{title}</h1>
        <div data-testid="modal-scroll">{children}</div>
        {footer ? <div data-testid="modal-footer">{footer}</div> : null}
      </div>
    ) : null,
}))

vi.mock('../components/ConfidenceIndicator', () => ({
  default: () => <span data-testid="confidence" />,
}))

vi.mock('../components/IngredientCorrection', () => ({
  default: () => null,
}))

const poolRecipe = {
  id: 'pool-uuid-1',
  recipeIdForCook: '500',
  title: 'Pool Pasta',
  extendedIngredients: [{ name: 'pasta', original: 'pasta' }],
  ingredient_flags: [],
  _fromPool: true,
  tier: 'cook_tonight',
}

describe('SuggestionDetailModal helpers', () => {
  it('resolveRecipeFetchId_prefers_recipeIdForCook', () => {
    expect(resolveRecipeFetchId(poolRecipe)).toBe('500')
  })

  it('shouldFetchRecipeDetails_false_when_snapshot_has_ingredients', () => {
    expect(shouldFetchRecipeDetails(poolRecipe)).toBe(false)
  })

  it('shouldFetchRecipeDetails_false_for_staple', () => {
    expect(
      shouldFetchRecipeDetails({
        id: 's1',
        recipeIdForCook: 'staple_omelette',
        extendedIngredients: [],
      })
    ).toBe(false)
  })

  it('shouldFetchRecipeDetails_true_for_thin_spoonacular_snapshot', () => {
    expect(
      shouldFetchRecipeDetails({
        id: 'pool-uuid-2',
        recipeIdForCook: '501',
        extendedIngredients: [],
      })
    ).toBe(true)
  })

  it('R4_mergeRecipeDetails_preserves_pool_identity', () => {
    const merged = mergeRecipeDetails(poolRecipe, {
      id: 500,
      title: 'Spoon Title',
      extendedIngredients: [{ name: 'tomato' }],
    })
    expect(merged.id).toBe('pool-uuid-1')
    expect(merged.recipeIdForCook).toBe('500')
    expect(merged._fromPool).toBe(true)
    expect(merged.extendedIngredients).toEqual([{ name: 'tomato' }])
  })

  it('hasInstructionContent_true_for_analyzed_steps_without_html', () => {
    expect(
      hasInstructionContent({
        instructions: '',
        analyzedInstructions: [{ steps: [{ number: 1, step: 'Boil' }] }],
      })
    ).toBe(true)
    expect(hasInstructionContent({ instructions: '  ', analyzedInstructions: [] })).toBe(false)
    expect(hasInstructionContent({ instructions: 'Boil pasta.' })).toBe(true)
  })
})

describe('SuggestionDetailModal', () => {
  beforeEach(() => {
    getRecipeDetails.mockReset()
    getRecipeDetails.mockResolvedValue({
      id: 501,
      title: 'Fetched',
      extendedIngredients: [{ name: 'rice', original: 'rice' }],
    })
  })

  it('does_not_fetch_when_snapshot_has_extendedIngredients', async () => {
    render(
      <SuggestionDetailModal
        isOpen
        onClose={() => {}}
        recipe={poolRecipe}
        loading={false}
        userId="user-1"
        pantryData={null}
        onCookedIt={vi.fn()}
      />
    )
    await waitFor(() => {
      expect(screen.getByText('pasta')).toBeInTheDocument()
    })
    expect(getRecipeDetails).not.toHaveBeenCalled()
  })

  it('fetches_with_recipeIdForCook_for_thin_snapshot', async () => {
    render(
      <SuggestionDetailModal
        isOpen
        onClose={() => {}}
        recipe={{
          id: 'pool-uuid-3',
          recipeIdForCook: '501',
          title: 'Thin',
          extendedIngredients: [],
        }}
        loading={false}
        userId="user-1"
        pantryData={null}
        onCookedIt={vi.fn()}
      />
    )
    await waitFor(() => {
      expect(getRecipeDetails).toHaveBeenCalledWith('user-1', '501')
    })
  })

  it('R4_onCookedIt_receives_pool_uuid_after_fetch', async () => {
    const onCookedIt = vi.fn()
    render(
      <SuggestionDetailModal
        isOpen
        onClose={() => {}}
        recipe={{
          id: 'pool-uuid-4',
          recipeIdForCook: '501',
          title: 'Thin',
          extendedIngredients: [],
          _fromPool: true,
        }}
        loading={false}
        userId="user-1"
        pantryData={null}
        onCookedIt={onCookedIt}
      />
    )
    await waitFor(() => {
      expect(getRecipeDetails).toHaveBeenCalled()
    })
    fireEvent.click(screen.getByRole('button', { name: /Cooked it/i }))
    expect(onCookedIt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pool-uuid-4', recipeIdForCook: '501' })
    )
  })

  it('disables_cook_button_when_busy', () => {
    render(
      <SuggestionDetailModal
        isOpen
        onClose={() => {}}
        recipe={poolRecipe}
        loading={false}
        userId="user-1"
        pantryData={null}
        onCookedIt={vi.fn()}
        cookDisabled
        cookBusy
      />
    )
    const btn = screen.getByRole('button', { name: /Recording/i })
    expect(btn).toBeDisabled()
    expect(screen.getByTestId('modal-footer')).toContainElement(btn)
    expect(screen.getByTestId('modal-scroll')).not.toContainElement(btn)
  })

  it('shows_variant_confidence_when_ingredient_flags_empty', async () => {
    render(
      <SuggestionDetailModal
        isOpen
        onClose={() => {}}
        recipe={poolRecipe}
        loading={false}
        userId="user-1"
        pantryData={{
          grouped: [
            {
              base_ingredient: 'pasta',
              variants: [
                {
                  id: 'pantry-pasta',
                  normalized_name: 'pasta',
                  confidence: 0.85,
                  use_soon: false,
                },
              ],
            },
          ],
        }}
        onCookedIt={vi.fn()}
      />
    )
    await waitFor(() => {
      expect(screen.getByText('pasta')).toBeInTheDocument()
    })
    expect(screen.getByTestId('confidence')).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('COOKED_IT_DISABLED_WHILE_DETAILS_LOADING', async () => {
    let resolveDetails
    getRecipeDetails.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDetails = resolve
        })
    )
    render(
      <SuggestionDetailModal
        isOpen
        onClose={() => {}}
        recipe={{
          id: 'pool-uuid-loading',
          recipeIdForCook: '502',
          title: 'Loading Soup',
          extendedIngredients: [],
        }}
        loading={false}
        userId="user-1"
        pantryData={null}
        onCookedIt={vi.fn()}
      />
    )
    const cookBtn = screen.getByRole('button', { name: /Cooked it/i })
    expect(cookBtn).toBeDisabled()
    resolveDetails({
      id: 502,
      title: 'Loading Soup',
      extendedIngredients: [{ name: 'broth', original: 'broth' }],
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Cooked it/i })).not.toBeDisabled()
    })
  })

  it('STALE_DETAILS_FETCH_IGNORED', async () => {
    let resolveA
    getRecipeDetails.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveA = resolve
        })
    )
    getRecipeDetails.mockResolvedValueOnce({
      id: 201,
      title: 'Recipe B',
      extendedIngredients: [{ name: 'rice', original: 'rice' }],
    })

    const { rerender } = render(
      <SuggestionDetailModal
        isOpen
        onClose={() => {}}
        recipe={{
          id: 'pool-a',
          recipeIdForCook: '100',
          title: 'Recipe A',
          extendedIngredients: [],
        }}
        loading={false}
        userId="user-1"
        pantryData={null}
        onCookedIt={vi.fn()}
      />
    )

    rerender(
      <SuggestionDetailModal
        isOpen
        onClose={() => {}}
        recipe={{
          id: 'pool-b',
          recipeIdForCook: '201',
          title: 'Recipe B',
          extendedIngredients: [],
        }}
        loading={false}
        userId="user-1"
        pantryData={null}
        onCookedIt={vi.fn()}
      />
    )

    resolveA({
      id: 100,
      title: 'Stale A',
      extendedIngredients: [{ name: 'stale-ingredient', original: 'stale-ingredient' }],
    })

    await waitFor(() => {
      expect(screen.getByText('rice')).toBeInTheDocument()
    })
    expect(screen.queryByText('stale-ingredient')).not.toBeInTheDocument()
  })

  it('does_not_attribute_rice_vinegar_or_ice_to_pantry_rice', async () => {
    render(
      <SuggestionDetailModal
        isOpen
        onClose={() => {}}
        recipe={{
          ...poolRecipe,
          extendedIngredients: [
            { name: 'rice vinegar', original: 'rice vinegar' },
            { name: 'ice', original: 'ice' },
          ],
        }}
        loading={false}
        userId="user-1"
        pantryData={{
          grouped: [
            {
              base_ingredient: 'rice',
              variants: [
                {
                  id: 'pantry-rice',
                  normalized_name: 'rice',
                  confidence: 0.9,
                  use_soon: false,
                },
              ],
            },
          ],
        }}
        onCookedIt={vi.fn()}
      />
    )
    await waitFor(() => {
      expect(screen.getByText('rice vinegar')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('confidence')).not.toBeInTheDocument()
  })
})
