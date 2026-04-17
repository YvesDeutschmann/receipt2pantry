import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Recipes from '../pages/Recipes'
import ConfidenceIndicator from '../components/ConfidenceIndicator'
import IngredientCorrection from '../components/IngredientCorrection'
import SuggestionRecipeCard from '../components/SuggestionRecipeCard'

const EMPTY_SUGGESTIONS = {
  use_soon_shelf: [],
  cook_tonight: [],
  probably_have: [],
  check_first: [],
}

const {
  getSuggestions,
  markCooked,
  dismissSuggestion,
  getHousehold,
  getPantry,
  getHealthCard,
  dismissHealthCard,
  getPool,
  getDepth,
  swipeSuggestion,
  triggerGeneration,
} = vi.hoisted(() => ({
  getSuggestions: vi.fn(),
  markCooked: vi.fn(),
  dismissSuggestion: vi.fn(),
  getHousehold: vi.fn(),
  getPantry: vi.fn(),
  getHealthCard: vi.fn(() => Promise.resolve({ show: false, items: [] })),
  dismissHealthCard: vi.fn(() => Promise.resolve({})),
  getPool: vi.fn(() =>
    Promise.resolve({
      pool: { breakfast: [], lunch: [], dinner: [] },
      household_id: 'h1',
    })
  ),
  getDepth: vi.fn(() =>
    Promise.resolve({
      depth: { breakfast: 5, lunch: 5, dinner: 5 },
      household_id: 'h1',
    })
  ),
  swipeSuggestion: vi.fn(() => Promise.resolve({ ok: true })),
  triggerGeneration: vi.fn(() =>
    Promise.resolve({ status: 'completed', suggestions_generated: 1 })
  ),
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 't@example.com' },
    session: {},
    loading: false,
  }),
}))

vi.mock('../components/HealthCard', () => ({
  default: () => null,
}))

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual('framer-motion')
  return {
    ...actual,
    motion: {
      ...actual.motion,
      div: ({
        children,
        onDragEnd,
        onTap,
        className,
        style,
        drag: _d,
        dragConstraints: _dc,
        dragElastic: _de,
        dragSnapToOrigin: _ds,
        ...rest
      }) => (
        <div className={className} style={style} {...rest}>
          <button
            type="button"
            data-testid="simulate-swipe-dismiss"
            className="sr-only"
            onClick={(e) => {
              e.stopPropagation()
              onDragEnd?.({}, { offset: { x: -150, y: 0 } })
            }}
          >
            dismiss
          </button>
          <div
            role="presentation"
            onClick={(e) => {
              if (e.target.closest('[data-testid="simulate-swipe-dismiss"]')) return
              if (e.target.closest('button')) return
              onTap?.(e)
            }}
          >
            {children}
          </div>
        </div>
      ),
    },
  }
})

vi.mock('../services/apiClient', () => ({
  api: {
    getSuggestions,
    markCooked,
    dismissSuggestion,
    getHousehold,
    getPantry,
    getHealthCard,
    dismissHealthCard,
    getRecipeDetails: vi.fn(() =>
      Promise.resolve({
        extendedIngredients: [{ name: 'x', original: 'x' }],
        instructions: '',
      })
    ),
    correctPantryItem: vi.fn(() => Promise.resolve({ ok: true })),
    suggestions: {
      getPool,
      getDepth,
      swipe: swipeSuggestion,
      triggerGeneration,
    },
  },
}))

function recipeStub(overrides) {
  return {
    id: 'r1',
    title: 'Test',
    image: null,
    tier: 'cook_tonight',
    score: 1,
    trigger_ingredient: null,
    ingredient_flags: [],
    ...overrides,
  }
}

describe('SuggestionScreen', () => {
  beforeEach(() => {
    getSuggestions.mockClear()
    markCooked.mockClear()
    dismissSuggestion.mockClear()
    getHousehold.mockClear()
    getPantry.mockClear()
    getHealthCard.mockClear()
    dismissHealthCard.mockClear()
    getPool.mockClear()
    getDepth.mockClear()
    swipeSuggestion.mockClear()
    triggerGeneration.mockClear()
    getHousehold.mockResolvedValue({ household: { id: 'h1' } })
    getPantry.mockResolvedValue({ grouped: [] })
    getHealthCard.mockResolvedValue({ show: false, items: [] })
    getSuggestions.mockImplementation(() => Promise.resolve(EMPTY_SUGGESTIONS))
    getPool.mockImplementation(() =>
      Promise.resolve({
        pool: { breakfast: [], lunch: [], dinner: [] },
        household_id: 'h1',
      })
    )
    getDepth.mockImplementation(() =>
      Promise.resolve({
        depth: { breakfast: 5, lunch: 5, dinner: 5 },
        household_id: 'h1',
      })
    )
  })

  it('SHELF_ORDER_RENDERS_CORRECTLY', async () => {
    const shelfPayload = {
      use_soon_shelf: [recipeStub({ id: 'u1', tier: 'use_soon' })],
      cook_tonight: [recipeStub({ id: 'c1' })],
      probably_have: [recipeStub({ id: 'p1', tier: 'probably_have' })],
      check_first: [recipeStub({ id: 'k1', tier: 'check_first' })],
    }
    getSuggestions.mockImplementation(() => Promise.resolve(shelfPayload))
    render(<Recipes />)
    await screen.findByText('Use before it\'s gone')
    await waitFor(() => {
      const text = document.body.textContent || ''
      const iUse = text.indexOf('Use before')
      const iCook = text.indexOf('Cook tonight')
      const iProb = text.indexOf('Probably have everything')
      const iCheck = text.indexOf('Quick check needed')
      expect(iUse).toBeGreaterThanOrEqual(0)
      expect(iCook).toBeGreaterThan(iUse)
      expect(iProb).toBeGreaterThan(iCook)
      expect(iCheck).toBeGreaterThan(iProb)
    })
  })

  it('EMPTY_SHELF_NOT_RENDERED', async () => {
    getSuggestions.mockImplementation(() =>
      Promise.resolve({
        use_soon_shelf: [],
        cook_tonight: [recipeStub({ id: 'c1' })],
        probably_have: [],
        check_first: [],
      })
    )
    render(<Recipes />)
    await screen.findByText('Cook tonight')
    expect(screen.queryByText('Use before it\'s gone')).not.toBeInTheDocument()
    expect(screen.queryByText('Probably have everything')).not.toBeInTheDocument()
    expect(screen.queryByText('Quick check needed')).not.toBeInTheDocument()
  })

  it('USE_SOON_HEADER_TWO_ITEMS', async () => {
    getSuggestions.mockImplementation(() =>
      Promise.resolve({
        use_soon_shelf: [
          recipeStub({
            id: 'a',
            tier: 'use_soon',
            ingredient_flags: [
              { ingredient_name: 'spinach', is_use_soon: true, confidence: 0.5, is_soft_required: false },
            ],
          }),
          recipeStub({
            id: 'b',
            tier: 'use_soon',
            ingredient_flags: [
              { ingredient_name: 'chicken', is_use_soon: true, confidence: 0.5, is_soft_required: false },
            ],
          }),
        ],
        cook_tonight: [],
        probably_have: [],
        check_first: [],
      })
    )
    render(<Recipes />)
    const el = await screen.findByText(/Recipes using your spinach and chicken/)
    expect(el).toBeInTheDocument()
  })

  it('USE_SOON_HEADER_THREE_PLUS_ITEMS', async () => {
    getSuggestions.mockImplementation(() =>
      Promise.resolve({
        use_soon_shelf: [
          recipeStub({
            id: 'a',
            tier: 'use_soon',
            ingredient_flags: [
              { ingredient_name: 'a', is_use_soon: true, confidence: 0.5, is_soft_required: false },
              { ingredient_name: 'b', is_use_soon: true, confidence: 0.5, is_soft_required: false },
              { ingredient_name: 'c', is_use_soon: true, confidence: 0.5, is_soft_required: false },
            ],
          }),
        ],
        cook_tonight: [],
        probably_have: [],
        check_first: [],
      })
    )
    render(<Recipes />)
    expect(
      await screen.findByText('Recipes using what needs using up')
    ).toBeInTheDocument()
  })

  it('CHECK_FIRST_SHOWS_TRIGGER_INGREDIENT', async () => {
    getSuggestions.mockImplementation(() =>
      Promise.resolve({
        use_soon_shelf: [],
        cook_tonight: [],
        probably_have: [],
        check_first: [
          recipeStub({
            id: 'k1',
            tier: 'check_first',
            trigger_ingredient: 'olive oil',
          }),
        ],
      })
    )
    render(<Recipes />)
    expect(
      await screen.findByText(/Confirm you still have: olive oil/)
    ).toBeInTheDocument()
  })

  it('COOKED_IT_CALLS_API_AND_REFRESHES', async () => {
    let afterCook = false
    markCooked.mockImplementation(async () => {
      afterCook = true
      return { ok: true }
    })
    const withRecipe = {
      use_soon_shelf: [],
      cook_tonight: [
        recipeStub({
          id: 'c1',
          ingredient_flags: [
            {
              ingredient_name: 'salt',
              confidence: 0.8,
              is_soft_required: false,
              is_use_soon: false,
            },
          ],
        }),
      ],
      probably_have: [],
      check_first: [],
    }
    getSuggestions.mockImplementation(() =>
      Promise.resolve(afterCook ? EMPTY_SUGGESTIONS : withRecipe)
    )

    render(<Recipes />)
    fireEvent.click(await screen.findByRole('button', { name: /Cooked it/i }))

    expect(markCooked).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ recipeId: 'c1' })
    )
    await waitFor(() => {
      expect(getSuggestions.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
    expect(await screen.findByText('Nice! Pantry updated.')).toBeInTheDocument()
  })

  it('DISMISS_REMOVES_CARD_OPTIMISTICALLY', async () => {
    getSuggestions.mockImplementation(() =>
      Promise.resolve({
        use_soon_shelf: [],
        cook_tonight: [
          recipeStub({ id: 'first', title: 'First Recipe' }),
          recipeStub({ id: 'second', title: 'Second Recipe' }),
        ],
        probably_have: [],
        check_first: [],
      })
    )
    dismissSuggestion.mockResolvedValue({ ok: true })

    render(<Recipes />)
    await screen.findByText('First Recipe')
    expect(screen.getByText('Second Recipe')).toBeInTheDocument()

    fireEvent.click(screen.getAllByTestId('simulate-swipe-dismiss')[0])

    await waitFor(() => {
      expect(screen.queryByText('First Recipe')).not.toBeInTheDocument()
    })
    expect(dismissSuggestion).toHaveBeenCalledWith('user-1', 'first', 'h1')
    expect(screen.getByText('Second Recipe')).toBeInTheDocument()
  })

  it('POOL_FALLS_BACK_TO_LIVE_SUGGESTIONS_WHEN_EMPTY', async () => {
    const shelfPayload = {
      use_soon_shelf: [],
      cook_tonight: [recipeStub({ id: 'c1' })],
      probably_have: [],
      check_first: [],
    }
    getSuggestions.mockImplementation(() => Promise.resolve(shelfPayload))
    render(<Recipes />)
    await screen.findByText('Cook tonight')
    expect(getPool).toHaveBeenCalled()
    expect(getSuggestions).toHaveBeenCalled()
  })

  it('POOL_FIRST_LOAD_SHOWS_READY_TO_COOK_WITHOUT_LIVE_SUGGESTIONS', async () => {
    getPool.mockResolvedValue({
      pool: {
        breakfast: [],
        lunch: [],
        dinner: [
          {
            id: 'sug-1',
            recipe_id: '500',
            recipe_name: 'Pool Pasta',
            recipe_image: null,
            recipe_data: { title: 'Pool Pasta' },
            match_score: 0.9,
          },
        ],
      },
      household_id: 'h1',
    })
    render(<Recipes />)
    await screen.findByText('Ready to cook')
    await screen.findByText('Pool Pasta')
    expect(getSuggestions).not.toHaveBeenCalled()
  })

  it('POOL_FIRST_LOAD_NO_SPINNER_AFTER_CONTENT', async () => {
    getPool.mockResolvedValue({
      pool: {
        dinner: [
          {
            id: 'sug-1',
            recipe_id: '500',
            recipe_name: 'Quick Pool',
            recipe_image: null,
            recipe_data: {},
            match_score: 0.9,
          },
        ],
      },
    })
    render(<Recipes />)
    await screen.findByText('Quick Pool')
    expect(document.querySelector('.animate-spin')).toBeNull()
  })

  it('POOL_SWIPE_USES_POOL_ENDPOINT_AND_LOW_WATERMARK', async () => {
    getPool.mockResolvedValue({
      pool: {
        breakfast: [],
        lunch: [],
        dinner: [
          {
            id: 'sug-1',
            recipe_id: '500',
            recipe_name: 'First',
            recipe_image: null,
            recipe_data: {},
            match_score: 0.9,
          },
          {
            id: 'sug-2',
            recipe_id: '501',
            recipe_name: 'Second',
            recipe_image: null,
            recipe_data: {},
            match_score: 0.8,
          },
        ],
      },
    })
    getDepth.mockResolvedValue({
      depth: { breakfast: 1, lunch: 5, dinner: 5 },
      household_id: 'h1',
    })
    render(<Recipes />)
    await screen.findByText('First')
    fireEvent.click(screen.getAllByTestId('simulate-swipe-dismiss')[0])
    await waitFor(() => {
      expect(swipeSuggestion).toHaveBeenCalledWith('user-1', 'sug-1', 'h1')
    })
    await waitFor(() => {
      expect(getDepth).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(triggerGeneration).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ triggerReason: 'low_watermark' })
      )
    })
  })
})

describe('ConfidenceIndicator', () => {
  it('CONFIDENCE_INDICATOR_SPICE', () => {
    render(
      <ConfidenceIndicator
        confidence={0.4}
        isSoftRequired
        isUseSoon={false}
      />
    )
    expect(screen.getByText('~')).toBeInTheDocument()
    expect(screen.getByText('check spice rack')).toBeInTheDocument()
  })

  it('CONFIDENCE_INDICATOR_CONFIRMED', () => {
    render(
      <ConfidenceIndicator confidence={0.8} isSoftRequired={false} isUseSoon={false} />
    )
    expect(screen.getByText('●')).toBeInTheDocument()
    expect(screen.getByText('confirmed')).toBeInTheDocument()
  })

  it('CONFIDENCE_INDICATOR_PROBABLY_HAVE', () => {
    render(
      <ConfidenceIndicator confidence={0.55} isSoftRequired={false} isUseSoon={false} />
    )
    expect(screen.getByText('◐')).toBeInTheDocument()
    expect(screen.getByText(/probably have — check freshness/)).toBeInTheDocument()
  })

  it('CONFIDENCE_INDICATOR_CHECK_PANTRY', () => {
    render(
      <ConfidenceIndicator confidence={0.3} isSoftRequired={false} isUseSoon={false} />
    )
    expect(screen.getByText('○')).toBeInTheDocument()
    expect(screen.getByText('check your pantry')).toBeInTheDocument()
  })
})

describe('IngredientCorrection', () => {
  it('INGREDIENT_CORRECTION_THREE_OPTIONS', () => {
    render(
      <IngredientCorrection
        itemId="item-uuid"
        ingredientName="Olive oil"
        onCorrection={vi.fn()}
        onDismiss={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /Still have it/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Used it up/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Never had it/i })).toBeInTheDocument()
  })

  it('INGREDIENT_CORRECTION_AUTO_DISMISS', async () => {
    const onCorrection = vi.fn()
    const onDismiss = vi.fn()
    render(
      <IngredientCorrection
        itemId="item-uuid"
        ingredientName="Olive oil"
        onCorrection={onCorrection}
        onDismiss={onDismiss}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Still have it/i }))
    expect(onCorrection).toHaveBeenCalledWith('item-uuid', 'still_have_it')
    await waitFor(() => expect(onDismiss).toHaveBeenCalled())
  })

  it('INGREDIENT_CORRECTION_NULL_ITEM_ID', () => {
    const { container } = render(
      <IngredientCorrection
        itemId={null}
        ingredientName="X"
        onCorrection={vi.fn()}
        onDismiss={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })
})

describe('SuggestionRecipeCard disclaimer', () => {
  it('MEAT_DISCLAIMER_ON_USE_SOON_CARD', () => {
    render(
      <SuggestionRecipeCard
        recipe={recipeStub({
          tier: 'use_soon',
          ingredient_flags: [
            {
              ingredient_name: 'chicken breast',
              is_use_soon: true,
              status_label: 'check_freshness',
              confidence: 0.5,
              is_soft_required: false,
              sub_class: 'raw_meat',
              put_back_count: 1,
            },
          ],
        })}
        onCookedIt={vi.fn()}
        onDismiss={vi.fn()}
        onExpand={vi.fn()}
      />
    )
    expect(screen.getByText(/Check before cooking/)).toBeInTheDocument()
  })

  it('NO_DISCLAIMER_ON_VEGGIE_USE_SOON', () => {
    render(
      <SuggestionRecipeCard
        recipe={recipeStub({
          tier: 'use_soon',
          ingredient_flags: [
            {
              ingredient_name: 'spinach',
              is_use_soon: true,
              status_label: 'check_freshness',
              confidence: 0.5,
              is_soft_required: false,
            },
          ],
        })}
        onCookedIt={vi.fn()}
        onDismiss={vi.fn()}
        onExpand={vi.fn()}
      />
    )
    expect(screen.queryByText(/Check before cooking/)).not.toBeInTheDocument()
  })
})
