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

vi.mock('../components/PullToRefresh', () => ({
  default: ({ onRefresh, children }) => (
    <div>
      <button type="button" onClick={() => void onRefresh()}>
        Pull refresh
      </button>
      {children}
    </div>
  ),
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
    triggerGeneration.mockImplementation(() =>
      Promise.resolve({ status: 'completed', suggestions_generated: 1 })
    )
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
      return {
        ok: true,
        touched: [{ pantry_item_id: 'p1', base_ingredient: 'salt', depletion_class: 'STAPLE' }],
      }
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
    expect(await screen.findByText('Used salt from your pantry.')).toBeInTheDocument()
  })

  it('COOKED_IT_EMPTY_TOUCHED_SHOWS_NO_MATCH_MESSAGE', async () => {
    markCooked.mockResolvedValue({ ok: true, touched: [] })
    getSuggestions.mockImplementation(() =>
      Promise.resolve({
        use_soon_shelf: [],
        cook_tonight: [
          recipeStub({
            id: 'c1',
            ingredient_flags: [{ ingredient_name: 'salt', confidence: 0.8 }],
          }),
        ],
        probably_have: [],
        check_first: [],
      })
    )
    render(<Recipes />)
    fireEvent.click(await screen.findByRole('button', { name: /Cooked it/i }))
    expect(
      await screen.findByText('Logged. Nothing in your pantry matched this recipe.')
    ).toBeInTheDocument()
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
    expect(getSuggestions).toHaveBeenCalled()
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

  it('POOL_COOK_SENDS_REAL_BOM_AND_SWIPES', async () => {
    let afterCook = false
    getPool.mockImplementation(async () => {
      if (afterCook) {
        return { pool: { breakfast: [], lunch: [], dinner: [] }, household_id: 'h1' }
      }
      return {
        pool: {
          breakfast: [],
          lunch: [],
          dinner: [
            {
              id: 'sug-pool-1',
              recipe_id: '500',
              recipe_name: 'Chicken Parm',
              recipe_image: null,
              recipe_data: {
                extendedIngredients: [
                  { name: 'chicken breast' },
                  { name: 'parmesan' },
                ],
              },
              match_score: 0.9,
            },
          ],
        },
        household_id: 'h1',
      }
    })
    markCooked.mockImplementation(async () => {
      afterCook = true
      return {
        ok: true,
        touched: [
          { pantry_item_id: 'p1', base_ingredient: 'chicken breast', depletion_class: 'PERISHABLE' },
          { pantry_item_id: 'p2', base_ingredient: 'parmesan', depletion_class: 'STAPLE' },
        ],
      }
    })
    swipeSuggestion.mockResolvedValue({ ok: true })

    render(<Recipes />)
    await screen.findByText('Chicken Parm')
    fireEvent.click(screen.getByRole('button', { name: /^Cooked it$/i }))

    await waitFor(() => {
      expect(markCooked).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          recipeId: '500',
          poolSuggestionId: 'sug-pool-1',
          ingredients: [
            { name: 'chicken breast', amount: 1, unit: 'serving' },
            { name: 'parmesan', amount: 1, unit: 'serving' },
          ],
        })
      )
    })
    await waitFor(() => {
      expect(screen.queryByText('Chicken Parm')).not.toBeInTheDocument()
    })
  })

  it('POOL_COOK_STAPLE_EMPTY_INGREDIENTS', async () => {
    getPool.mockImplementation(async () => ({
      pool: {
        breakfast: [],
        lunch: [],
        dinner: [
          {
            id: 'sug-staple',
            recipe_id: 'staple_omelette',
            recipe_name: 'Omelette',
            recipe_data: {},
            match_score: 1,
          },
        ],
      },
      household_id: 'h1',
    }))
    markCooked.mockResolvedValue({ ok: true, touched: [] })

    render(<Recipes />)
    await screen.findByText('Omelette')
    fireEvent.click(screen.getByRole('button', { name: /^Cooked it$/i }))

    await waitFor(() => {
      expect(markCooked).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          recipeId: 'staple_omelette',
          poolSuggestionId: 'sug-staple',
          ingredients: [],
        })
      )
    })
    expect(swipeSuggestion).not.toHaveBeenCalled()
  })

  it('POOL_COOK_EMPTY_BOM_SKIPS_MARKCOOKED', async () => {
    getPool.mockImplementation(async () => ({
      pool: {
        dinner: [
          {
            id: 'sug-thin',
            recipe_id: '600',
            recipe_name: 'Mystery Meal',
            recipe_data: {},
            match_score: 0.5,
          },
        ],
      },
      household_id: 'h1',
    }))

    render(<Recipes />)
    await screen.findByText('Mystery Meal')
    fireEvent.click(screen.getByRole('button', { name: /^Cooked it$/i }))

    await waitFor(() => {
      expect(screen.getByText(/Open the recipe to log what you used/)).toBeInTheDocument()
    })
    expect(markCooked).not.toHaveBeenCalled()
    expect(swipeSuggestion).not.toHaveBeenCalled()
  })

  it('POOL_COOK_DOUBLE_TAP_SINGLE_MARKCOOKED', async () => {
    let resolveCook
    markCooked.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCook = () => resolve({ ok: true, touched: [] })
        })
    )
    getPool.mockImplementation(async () => ({
      pool: {
        dinner: [
          {
            id: 'sug-dup',
            recipe_id: '700',
            recipe_name: 'Dup Test',
            recipe_data: { extendedIngredients: [{ name: 'rice' }] },
            match_score: 0.9,
          },
        ],
      },
      household_id: 'h1',
    }))

    render(<Recipes />)
    await screen.findByText('Dup Test')
    const btn = screen.getByRole('button', { name: /^Cooked it$/i })
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(markCooked).toHaveBeenCalledTimes(1)
    resolveCook()
    await waitFor(() => {
      expect(swipeSuggestion).not.toHaveBeenCalled()
    })
  })

  it('POOL_COOK_MARKCOOKED_FAILURE_NO_SWIPE', async () => {
    markCooked.mockRejectedValue(new Error('network'))
    getPool.mockImplementation(async () => ({
      pool: {
        dinner: [
          {
            id: 'sug-fail',
            recipe_id: '800',
            recipe_name: 'Fail Test',
            recipe_data: { extendedIngredients: [{ name: 'salt' }] },
            match_score: 0.9,
          },
        ],
      },
      household_id: 'h1',
    }))

    render(<Recipes />)
    await screen.findByText('Fail Test')
    fireEvent.click(screen.getByRole('button', { name: /^Cooked it$/i }))

    await waitFor(() => {
      expect(screen.getByText(/partially recorded/)).toBeInTheDocument()
    })
    expect(swipeSuggestion).not.toHaveBeenCalled()
    expect(screen.getByText('Fail Test')).toBeInTheDocument()
  })

  it('POOL_COOK_SWIPE_FAILURE_CARD_STAYS_GONE', async () => {
    const poolRow = {
      id: 'sug-swipe-fail',
      recipe_id: '900',
      recipe_name: 'Swipe Fail',
      recipe_data: { extendedIngredients: [{ name: 'pasta' }] },
      match_score: 0.9,
    }
    getPool.mockImplementation(async () => ({
      pool: { dinner: [poolRow] },
      household_id: 'h1',
    }))
    markCooked.mockResolvedValue({ ok: true, touched: [] })

    render(<Recipes />)
    await screen.findByText('Swipe Fail')
    fireEvent.click(screen.getByRole('button', { name: /^Cooked it$/i }))

    await waitFor(() => {
      expect(markCooked).toHaveBeenCalled()
    })
    expect(swipeSuggestion).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.queryByText('Swipe Fail')).not.toBeInTheDocument()
    })
  })

  it('POOL_COOK_ORDERING_REFILL_AFTER_MARKCOOKED', async () => {
    const callOrder = []
    markCooked.mockImplementation(async () => {
      callOrder.push('markCooked')
      return { ok: true, touched: [] }
    })
    getDepth.mockImplementation(async () => {
      callOrder.push('getDepth')
      return { depth: { breakfast: 1, lunch: 5, dinner: 5 }, household_id: 'h1' }
    })
    getPool.mockImplementation(async () => {
      callOrder.push('getPool')
      return {
        pool: {
          dinner: [
            {
              id: 'sug-order',
              recipe_id: '950',
              recipe_name: 'Order Test',
              recipe_data: { extendedIngredients: [{ name: 'beans' }] },
              match_score: 0.9,
            },
          ],
        },
        household_id: 'h1',
      }
    })

    render(<Recipes />)
    await screen.findByText('Order Test')
    fireEvent.click(screen.getByRole('button', { name: /^Cooked it$/i }))

    await waitFor(() => {
      expect(callOrder.indexOf('markCooked')).toBeGreaterThanOrEqual(0)
      expect(callOrder.indexOf('getDepth')).toBeGreaterThan(callOrder.indexOf('markCooked'))
      const poolAfterCook = callOrder.filter((c) => c === 'getPool').length
      expect(poolAfterCook).toBeGreaterThan(1)
    })
    expect(swipeSuggestion).not.toHaveBeenCalled()
  })

  it('POST_COOK_PERISHABLE_PROMPT_SUPPRESSES_HEALTH_CARD', async () => {
    markCooked.mockResolvedValue({
      ok: true,
      touched: [
        { pantry_item_id: 'p1', base_ingredient: 'spinach', depletion_class: 'PERISHABLE' },
      ],
    })
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        recipeStub({
          id: 'c1',
          title: 'Spinach Pasta',
          extendedIngredients: [{ name: 'spinach', original: 'spinach' }],
        }),
      ],
      probably_have: [],
      check_first: [],
    })
    render(<Recipes />)
    await screen.findByText('Spinach Pasta')
    fireEvent.click(screen.getByRole('button', { name: /Cooked it/i }))
    await waitFor(() => {
      expect(screen.getByText('Still have these?')).toBeInTheDocument()
      expect(screen.getByText('spinach')).toBeInTheDocument()
    })
    expect(getHealthCard).not.toHaveBeenCalled()
  })

  it('POOL_SHOWS_USE_SOON_ABOVE_READY_TO_COOK', async () => {
    getPool.mockResolvedValue({
      pool: {
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
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [
        recipeStub({
          id: 'us1',
          title: 'Spinach Soup',
          tier: 'use_soon',
          ingredient_flags: [
            { ingredient_name: 'spinach', is_use_soon: true, confidence: 0.5 },
          ],
        }),
      ],
      cook_tonight: [],
      probably_have: [],
      check_first: [],
    })
    render(<Recipes />)
    const useSoonHeader = await screen.findByText("Use before it's gone")
    const readyHeader = await screen.findByText('Ready to cook')
    expect(
      useSoonHeader.compareDocumentPosition(readyHeader) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.getByText('Spinach Soup')).toBeInTheDocument()
    expect(screen.getByText('Pool Pasta')).toBeInTheDocument()
  })

  it('PULL_REFRESH_AWAITS_GENERATION_THEN_RELOADS', async () => {
    let resolveGen
    triggerGeneration.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGen = resolve
        })
    )
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [recipeStub({ id: 'c1', title: 'Old Card' })],
      probably_have: [],
      check_first: [],
    })
    render(<Recipes />)
    await screen.findByText('Old Card')
    const poolCallsBefore = getPool.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: /Pull refresh/i }))
    await waitFor(() => {
      expect(triggerGeneration).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ triggerReason: 'manual_refresh' })
      )
    })
    expect(getPool.mock.calls.length).toBe(poolCallsBefore)
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [recipeStub({ id: 'c2', title: 'New Card' })],
      probably_have: [],
      check_first: [],
    })
    resolveGen({ status: 'completed', suggestions_generated: 1 })
    await screen.findByText('New Card')
  })

  it('POOL_COOK_CARD_GONE_AFTER_REMOUNT', async () => {
    let afterCook = false
    getPool.mockImplementation(async () => {
      if (afterCook) {
        return { pool: { breakfast: [], lunch: [], dinner: [] }, household_id: 'h1' }
      }
      return {
        pool: {
          breakfast: [],
          lunch: [],
          dinner: [
            {
              id: 'sug-remount',
              recipe_id: '500',
              recipe_name: 'Remount Soup',
              recipe_data: { extendedIngredients: [{ name: 'carrot' }] },
              match_score: 0.9,
            },
          ],
        },
        household_id: 'h1',
      }
    })
    markCooked.mockImplementation(async () => {
      afterCook = true
      return { ok: true, touched: [] }
    })
    const { unmount } = render(<Recipes />)
    await screen.findByText('Remount Soup')
    fireEvent.click(screen.getByRole('button', { name: /^Cooked it$/i }))
    await waitFor(() => expect(markCooked).toHaveBeenCalledTimes(1))
    unmount()
    render(<Recipes />)
    await waitFor(() => expect(getPool.mock.calls.length).toBeGreaterThan(1))
    expect(screen.queryByText('Remount Soup')).not.toBeInTheDocument()
    expect(swipeSuggestion).not.toHaveBeenCalled()
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
