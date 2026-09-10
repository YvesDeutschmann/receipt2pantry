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
  devCookLoopReport,
  postDevLog,
  getRecipeDetails,
} = vi.hoisted(() => ({
  getSuggestions: vi.fn(),
  getRecipeDetails: vi.fn(() =>
    Promise.resolve({
      extendedIngredients: [{ name: 'x', original: 'x' }],
      instructions: 'Step one.\nStep two.',
      analyzedInstructions: [{ steps: [{ number: 1, step: 'Step one.' }] }],
    })
  ),
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
  devCookLoopReport: vi.fn(() =>
    Promise.resolve({ ok: true, mode: 'observe', checks: [] })
  ),
  postDevLog: vi.fn(),
}))

const mockAuthUser = vi.hoisted(() => ({
  current: { id: 'user-1', email: 't@example.com' },
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockAuthUser.current,
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
    devCookLoopReport,
    getRecipeDetails,
    correctPantryItem: vi.fn(() => Promise.resolve({ ok: true })),
    suggestions: {
      getPool,
      getDepth,
      swipe: swipeSuggestion,
      triggerGeneration,
    },
  },
  postDevLog,
}))

const emit = vi.fn()
const emitRepeatable = vi.fn()

vi.mock('../services/funnelTelemetry', () => ({
  emit: (...args) => emit(...args),
  emitRepeatable: (...args) => emitRepeatable(...args),
  FunnelEvent: {
    FIRST_SUGGESTION_VIEWED: 'funnel_first_suggestion_viewed',
    FIRST_COOK_LOGGED: 'funnel_first_cook_logged',
    RECIPE_DETAIL_OPENED: 'recipe_detail_opened',
    COOK_LOGGED: 'cook_logged',
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
    pantry_highlights: [],
    readyInMinutes: null,
    meal_type: null,
    pool_suggestion_id: null,
    ...overrides,
  }
}

function poolCookCard(overrides = {}) {
  const poolId = overrides.pool_suggestion_id ?? 'sug-1'
  const recipeId = overrides.id ?? '500'
  return recipeStub({
    id: String(recipeId),
    pool_suggestion_id: poolId,
    meal_type: 'dinner',
    score: 0.9,
    ...overrides,
  })
}

function sixCookTonight(prefix) {
  return Array.from({ length: 6 }, (_, i) =>
    poolCookCard({
      id: `${prefix}-${i + 1}`,
      title: `${prefix} Meal ${i + 1}`,
      pool_suggestion_id: `${prefix}-sug-${i + 1}`,
      meal_type: 'dinner',
      score: 0.99 - i * 0.01,
    })
  )
}

async function cookFromModal(title) {
  const restoreIO = stubIntersectingObserver()
  fireEvent.click(screen.getByText(title))
  const buttons = await screen.findAllByRole('button', { name: /^Cooked it$/i })
  fireEvent.click(buttons[buttons.length - 1])
  restoreIO()
}

function stubIntersectingObserver() {
  const original = global.IntersectionObserver
  global.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback
    }
    observe() {
      this.callback([{ isIntersecting: true }])
    }
    unobserve() {}
    disconnect() {}
  }
  return () => {
    global.IntersectionObserver = original
  }
}

describe('SuggestionScreen', () => {
  beforeEach(() => {
    mockAuthUser.current = { id: 'user-1', email: 't@example.com' }
    getSuggestions.mockClear()
    markCooked.mockClear()
    dismissSuggestion.mockClear()
    getHousehold.mockClear()
    getPantry.mockClear()
    getHealthCard.mockClear()
    dismissHealthCard.mockClear()
    getPool.mockClear()
    getRecipeDetails.mockClear()
    getDepth.mockClear()
    swipeSuggestion.mockClear()
    triggerGeneration.mockClear()
    devCookLoopReport.mockClear()
    postDevLog.mockClear()
    emit.mockClear()
    emitRepeatable.mockClear()
    triggerGeneration.mockImplementation(() =>
      Promise.resolve({ status: 'completed', suggestions_generated: 1 })
    )
    getHousehold.mockResolvedValue({ household: { id: 'h1' } })
    getPantry.mockResolvedValue({ grouped: [] })
    getHealthCard.mockResolvedValue({ show: false, items: [] })
    getSuggestions.mockImplementation(() => Promise.resolve(EMPTY_SUGGESTIONS))
    getRecipeDetails.mockImplementation(() =>
      Promise.resolve({
        extendedIngredients: [{ name: 'x', original: 'x' }],
        instructions: 'Step one.\nStep two.',
        analyzedInstructions: [{ steps: [{ number: 1, step: 'Step one.' }] }],
      })
    )
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
    await screen.findByText('Test')
    await cookFromModal('Test')

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
    await screen.findByText('Test')
    await cookFromModal('Test')
    expect(
      await screen.findByText('Logged. Nothing in your pantry matched this recipe.')
    ).toBeInTheDocument()
  })

  it('LIST_HAS_NO_COOKED_IT_OR_INGREDIENT_CORRECTION', async () => {
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [recipeStub({ id: 'c1', title: 'List Card' })],
      probably_have: [],
      check_first: [
        recipeStub({
          id: 'k1',
          title: 'Check Card',
          tier: 'check_first',
          trigger_ingredient: 'milk',
        }),
      ],
    })
    render(<Recipes />)
    await screen.findByText('List Card')
    expect(screen.queryAllByRole('button', { name: /^Cooked it$/i })).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /Still have it/i })).not.toBeInTheDocument()
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
    expect(getPool).not.toHaveBeenCalled()
    expect(getSuggestions).toHaveBeenCalled()
  })

  it('NO_POOL_SUBTITLE_AND_NO_OUTER_SHELF_CARD', async () => {
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        poolCookCard({ id: '500', title: 'Pool Pasta', pool_suggestion_id: 'sug-1' }),
      ],
      probably_have: [],
      check_first: [],
    })
    const { container } = render(<Recipes />)
    await screen.findByText('Pool Pasta')
    expect(screen.queryByText(/From your suggestion pool/i)).not.toBeInTheDocument()
    expect(container.querySelector('.card .eyebrow')).toBeNull()
  })

  it('POOL_FIRST_LOAD_SHOWS_COOK_TONIGHT_FROM_SUGGESTIONS', async () => {
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        poolCookCard({ id: '500', title: 'Pool Pasta', pool_suggestion_id: 'sug-1' }),
      ],
      probably_have: [],
      check_first: [],
    })
    render(<Recipes />)
    await screen.findByText('Cook tonight')
    await screen.findByText('Pool Pasta')
    expect(getSuggestions).toHaveBeenCalled()
    expect(getPool).not.toHaveBeenCalled()
  })

  it('POOL_FIRST_LOAD_NO_SPINNER_AFTER_CONTENT', async () => {
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        poolCookCard({ id: '500', title: 'Quick Pool', pool_suggestion_id: 'sug-1' }),
      ],
      probably_have: [],
      check_first: [],
    })
    render(<Recipes />)
    await screen.findByText('Quick Pool')
    expect(document.querySelector('.animate-spin')).toBeNull()
  })

  it('POOL_SWIPE_USES_POOL_ENDPOINT_AND_LOW_WATERMARK', async () => {
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        poolCookCard({ id: '500', title: 'First', pool_suggestion_id: 'sug-1' }),
        poolCookCard({ id: '501', title: 'Second', pool_suggestion_id: 'sug-2', score: 0.8 }),
      ],
      probably_have: [],
      check_first: [],
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
    getSuggestions.mockImplementation(async () => {
      if (afterCook) return EMPTY_SUGGESTIONS
      return {
        use_soon_shelf: [],
        cook_tonight: [
          poolCookCard({
            id: '500',
            title: 'Chicken Parm',
            pool_suggestion_id: 'sug-pool-1',
            extendedIngredients: [
              { name: 'chicken breast' },
              { name: 'parmesan' },
            ],
          }),
        ],
        probably_have: [],
        check_first: [],
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
    await cookFromModal('Chicken Parm')

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
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        poolCookCard({
          id: 'staple_omelette',
          title: 'Omelette',
          pool_suggestion_id: 'sug-staple',
          score: 1,
        }),
      ],
      probably_have: [],
      check_first: [],
    })
    markCooked.mockResolvedValue({ ok: true, touched: [] })

    render(<Recipes />)
    await screen.findByText('Omelette')
    await cookFromModal('Omelette')

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
    getRecipeDetails.mockResolvedValue({
      extendedIngredients: [],
      instructions: '',
      analyzedInstructions: [],
    })
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        poolCookCard({
          id: '600',
          title: 'Mystery Meal',
          pool_suggestion_id: 'sug-thin',
          score: 0.5,
        }),
      ],
      probably_have: [],
      check_first: [],
    })

    render(<Recipes />)
    await screen.findByText('Mystery Meal')
    await cookFromModal('Mystery Meal')

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
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        poolCookCard({
          id: '700',
          title: 'Dup Test',
          pool_suggestion_id: 'sug-dup',
          extendedIngredients: [{ name: 'rice' }],
        }),
      ],
      probably_have: [],
      check_first: [],
    })

    render(<Recipes />)
    await screen.findByText('Dup Test')
    fireEvent.click(screen.getByText('Dup Test'))
    const btn = await screen.findByRole('button', { name: /^Cooked it$/i })
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(markCooked).toHaveBeenCalledTimes(1)
    resolveCook()
    await waitFor(() => {
      expect(swipeSuggestion).not.toHaveBeenCalled()
    })
  })

  it('RECIPE_DETAIL_OPENED_TELEMETRY_ON_EXPAND', async () => {
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [recipeStub({ id: 'c1', title: 'Telemetry Pasta' })],
      probably_have: [],
      check_first: [],
    })
    render(<Recipes />)
    await screen.findByText('Telemetry Pasta')
    fireEvent.click(screen.getByText('Telemetry Pasta'))
    await waitFor(() => {
      expect(emitRepeatable).toHaveBeenCalledWith(
        'recipe_detail_opened',
        'user-1',
        expect.objectContaining({ recipeId: 'c1' })
      )
    })
  })

  it('COOK_LOGGED_TELEMETRY_ON_EVERY_COOK', async () => {
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        recipeStub({
          id: 'c1',
          title: 'Cook Telemetry',
          extendedIngredients: [{ name: 'beans', original: 'beans' }],
        }),
      ],
      probably_have: [],
      check_first: [],
    })
    markCooked.mockResolvedValue({ ok: true, touched: [] })
    render(<Recipes />)
    await screen.findByText('Cook Telemetry')
    await cookFromModal('Cook Telemetry')
    await waitFor(() => {
      expect(emitRepeatable).toHaveBeenCalledWith(
        'cook_logged',
        'user-1',
        expect.objectContaining({ recipeId: 'c1' })
      )
    })
  })

  it('EXIT_CONFIRM_AFTER_VIEW_THRESHOLD', async () => {
    let now = 1_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const restoreIO = stubIntersectingObserver()

    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        recipeStub({
          id: 'c1',
          title: 'Exit Confirm Soup',
          extendedIngredients: [{ name: 'carrot', original: 'carrot' }],
          instructions: 'Boil carrots.',
        }),
      ],
      probably_have: [],
      check_first: [],
    })

    render(<Recipes />)
    await screen.findByText('Exit Confirm Soup')
    fireEvent.click(screen.getByText('Exit Confirm Soup'))
    const closeButtons = await screen.findAllByRole('button', { name: /^Close$/i })
    now += 31_000
    fireEvent.click(closeButtons[closeButtons.length - 1])
    await waitFor(() => {
      expect(screen.getByText('Did you cook this?')).toBeInTheDocument()
    })
    nowSpy.mockRestore()
    restoreIO()
  })

  it('EXIT_CONFIRM_NOT_BEFORE_THRESHOLD', async () => {
    let now = 1_500_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const restoreIO = stubIntersectingObserver()

    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        recipeStub({
          id: 'c1',
          title: 'Too Fast Soup',
          extendedIngredients: [{ name: 'carrot', original: 'carrot' }],
          instructions: 'Boil carrots.',
        }),
      ],
      probably_have: [],
      check_first: [],
    })

    render(<Recipes />)
    await screen.findByText('Too Fast Soup')
    fireEvent.click(screen.getByText('Too Fast Soup'))
    const closeButtons = await screen.findAllByRole('button', { name: /^Close$/i })
    now += 5_000
    fireEvent.click(closeButtons[closeButtons.length - 1])
    await waitFor(() => {
      expect(screen.queryByText('Did you cook this?')).not.toBeInTheDocument()
    })
    nowSpy.mockRestore()
    restoreIO()
  })

  it('EXIT_CONFIRM_ANALYZED_INSTRUCTIONS_WITHOUT_HTML', async () => {
    let now = 1_800_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const restoreIO = stubIntersectingObserver()

    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        recipeStub({
          id: 'c1',
          title: 'Analyzed Only',
          extendedIngredients: [{ name: 'rice', original: 'rice' }],
          instructions: '',
          analyzedInstructions: [{ steps: [{ number: 1, step: 'Cook the rice.' }] }],
        }),
      ],
      probably_have: [],
      check_first: [],
    })

    render(<Recipes />)
    await screen.findByText('Analyzed Only')
    fireEvent.click(screen.getByText('Analyzed Only'))
    expect(await screen.findByText('Cook the rice.')).toBeInTheDocument()
    const closeButtons = await screen.findAllByRole('button', { name: /^Close$/i })
    now += 31_000
    fireEvent.click(closeButtons[closeButtons.length - 1])
    await waitFor(() => {
      expect(screen.getByText('Did you cook this?')).toBeInTheDocument()
    })
    nowSpy.mockRestore()
    restoreIO()
  })

  it('EXIT_CONFIRM_WITHOUT_INSTRUCTIONS_AFTER_THRESHOLD', async () => {
    let now = 4_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)

    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        recipeStub({
          id: 'c1',
          title: 'No Steps Pasta',
          extendedIngredients: [{ name: 'pasta', original: 'pasta' }],
          instructions: '',
          analyzedInstructions: [],
        }),
      ],
      probably_have: [],
      check_first: [],
    })

    render(<Recipes />)
    await screen.findByText('No Steps Pasta')
    fireEvent.click(screen.getByText('No Steps Pasta'))
    const closeButtons = await screen.findAllByRole('button', { name: /^Close$/i })
    now += 31_000
    fireEvent.click(closeButtons[closeButtons.length - 1])
    await waitFor(() => {
      expect(screen.getByText('Did you cook this?')).toBeInTheDocument()
    })
    nowSpy.mockRestore()
  })

  it('EXIT_CONFIRM_ONE_TAP_COOK_PRESERVES_POOL_ID', async () => {
    let now = 2_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const restoreIO = stubIntersectingObserver()

    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        poolCookCard({
          id: '900',
          title: 'Pool Exit',
          pool_suggestion_id: 'pool-sug-1',
          extendedIngredients: [{ name: 'rice', original: 'rice' }],
          instructions: 'Cook rice.',
        }),
      ],
      probably_have: [],
      check_first: [],
    })
    markCooked.mockResolvedValue({ ok: true, touched: [] })

    render(<Recipes />)
    await screen.findByText('Pool Exit')
    fireEvent.click(screen.getByText('Pool Exit'))
    const closeButtons = await screen.findAllByRole('button', { name: /^Close$/i })
    now += 31_000
    fireEvent.click(closeButtons[closeButtons.length - 1])
    await screen.findByText('Did you cook this?')
    fireEvent.click(screen.getByRole('button', { name: /Yes, cooked it/i }))
    await waitFor(() => {
      expect(markCooked).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          poolSuggestionId: 'pool-sug-1',
          ingredients: [{ name: 'rice', amount: 1, unit: 'serving' }],
        })
      )
    })
    nowSpy.mockRestore()
    restoreIO()
  })

  it('EXIT_CONFIRM_DISMISS_SUPPRESSES_RE_PROMPT', async () => {
    let now = 3_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const restoreIO = stubIntersectingObserver()

    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        recipeStub({
          id: 'c1',
          title: 'Dismiss Prompt',
          extendedIngredients: [{ name: 'lentils', original: 'lentils' }],
          instructions: 'Simmer lentils.',
        }),
      ],
      probably_have: [],
      check_first: [],
    })

    render(<Recipes />)
    await screen.findByText('Dismiss Prompt')
    const openAndClose = async () => {
      fireEvent.click(screen.getByText('Dismiss Prompt'))
      const closeButtons = await screen.findAllByRole('button', { name: /^Close$/i })
      now += 31_000
      fireEvent.click(closeButtons[closeButtons.length - 1])
    }
    await openAndClose()
    await screen.findByText('Did you cook this?')
    fireEvent.click(screen.getByRole('button', { name: /Not this time/i }))
    await waitFor(() => {
      expect(screen.queryByText('Did you cook this?')).not.toBeInTheDocument()
    })
    now += 31_000
    await openAndClose()
    expect(screen.queryByText('Did you cook this?')).not.toBeInTheDocument()
    nowSpy.mockRestore()
    restoreIO()
  })

  it('EXIT_CONFIRM_TOAST_PORTALED', async () => {
    let now = 5_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const restoreIO = stubIntersectingObserver()

    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        recipeStub({
          id: 'c1',
          title: 'Portal Soup',
          extendedIngredients: [{ name: 'carrot', original: 'carrot' }],
          instructions: 'Boil carrots.',
        }),
      ],
      probably_have: [],
      check_first: [],
    })

    render(<Recipes />)
    await screen.findByText('Portal Soup')
    fireEvent.click(screen.getByText('Portal Soup'))
    const closeButtons = await screen.findAllByRole('button', { name: /^Close$/i })
    now += 31_000
    fireEvent.click(closeButtons[closeButtons.length - 1])
    await waitFor(() => {
      expect(screen.getByText('Did you cook this?')).toBeInTheDocument()
    })
    const overlay = screen.getByTestId('exit-confirm-overlay')
    expect(document.body).toContainElement(overlay)
    expect(overlay.className).toContain('pb-tab-bar')
    expect(overlay.className).toContain('pointer-events-none')

    nowSpy.mockRestore()
    restoreIO()
  })

  it('FAILED_COOK_LEAVES_SHEET_OPEN', async () => {
    const restoreIO = stubIntersectingObserver()
    markCooked.mockRejectedValue(new Error('network'))
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        recipeStub({
          id: 'c1',
          title: 'Sheet Stay Open',
          extendedIngredients: [{ name: 'lentils', original: 'lentils' }],
          instructions: 'Simmer lentils.',
        }),
      ],
      probably_have: [],
      check_first: [],
    })

    render(<Recipes />)
    await screen.findByText('Sheet Stay Open')
    fireEvent.click(screen.getByText('Sheet Stay Open'))
    const cookedButtons = await screen.findAllByRole('button', { name: /^Cooked it$/i })
    fireEvent.click(cookedButtons[cookedButtons.length - 1])

    await waitFor(() => {
      expect(screen.getByText(/partially recorded/)).toBeInTheDocument()
    })
    expect(screen.getAllByRole('button', { name: /^Close$/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /^Cooked it$/i }).length).toBeGreaterThan(0)

    markCooked.mockClear()
    markCooked.mockResolvedValue({ ok: true, touched: [] })
    restoreIO()
  })

  it('FAILED_COOK_EMPTY_BOM_LEAVES_SHEET_OPEN', async () => {
    const restoreIO = stubIntersectingObserver()
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        recipeStub({
          id: 'c1',
          title: 'Empty BOM Soup',
          extendedIngredients: [],
          ingredient_flags: [],
          instructions: 'Guess.',
        }),
      ],
      probably_have: [],
      check_first: [],
    })

    render(<Recipes />)
    await screen.findByText('Empty BOM Soup')
    fireEvent.click(screen.getByText('Empty BOM Soup'))
    const cookedButtons = await screen.findAllByRole('button', { name: /^Cooked it$/i })
    fireEvent.click(cookedButtons[cookedButtons.length - 1])

    await waitFor(() => {
      expect(screen.getByText(/Open the recipe to log what you used/i)).toBeInTheDocument()
    })
    expect(screen.getAllByRole('button', { name: /^Close$/i }).length).toBeGreaterThan(0)
    expect(markCooked).not.toHaveBeenCalled()
    restoreIO()
  })

  it('CHECK_FIRST_NAMED_LINE_WITHOUT_LIST_CORRECTION', async () => {
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [],
      probably_have: [],
      check_first: [
        recipeStub({
          id: 'k1',
          tier: 'check_first',
          title: 'Curry Check',
          trigger_ingredient: 'coconut milk',
        }),
      ],
    })
    render(<Recipes />)
    await screen.findByText('Curry Check')
    expect(screen.getByText(/Confirm you still have: coconut milk/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Still have it/i })).not.toBeInTheDocument()
  })

  it('CHECK_FIRST_SHOWS_WITH_WARM_POOL', async () => {
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        poolCookCard({
          id: '500',
          title: 'Pool Pasta',
          pool_suggestion_id: 'sug-pool',
          extendedIngredients: [{ name: 'pasta' }],
        }),
      ],
      probably_have: [recipeStub({ id: 'p1', title: 'Probably Salad', tier: 'probably_have' })],
      check_first: [
        recipeStub({
          id: 'k1',
          title: 'Check Curry',
          tier: 'check_first',
          trigger_ingredient: 'coconut milk',
        }),
      ],
    })
    render(<Recipes />)
    await screen.findByText('Pool Pasta')
    expect(screen.getByText('Cook tonight')).toBeInTheDocument()
    expect(screen.getByText('Check Curry')).toBeInTheDocument()
    expect(screen.getByText('Quick check needed')).toBeInTheDocument()
    expect(screen.getByText('Probably Salad')).toBeInTheDocument()
    expect(screen.getByText(/Confirm you still have: coconut milk/i)).toBeInTheDocument()
  })

  it('POOL_COOK_MARKCOOKED_FAILURE_NO_SWIPE', async () => {
    markCooked.mockRejectedValue(new Error('network'))
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        poolCookCard({
          id: '800',
          title: 'Fail Test',
          pool_suggestion_id: 'sug-fail',
          extendedIngredients: [{ name: 'salt' }],
        }),
      ],
      probably_have: [],
      check_first: [],
    })

    render(<Recipes />)
    await screen.findByText('Fail Test')
    await cookFromModal('Fail Test')

    await waitFor(() => {
      expect(screen.getByText(/partially recorded/)).toBeInTheDocument()
    })
    expect(swipeSuggestion).not.toHaveBeenCalled()
    expect(screen.getAllByText('Fail Test').length).toBeGreaterThan(0)
  })

  it('POOL_COOK_SWIPE_FAILURE_CARD_STAYS_GONE', async () => {
    let afterCook = false
    getSuggestions.mockImplementation(async () => {
      if (afterCook) return EMPTY_SUGGESTIONS
      return {
        use_soon_shelf: [],
        cook_tonight: [
          poolCookCard({
            id: '900',
            title: 'Swipe Fail',
            pool_suggestion_id: 'sug-swipe-fail',
            extendedIngredients: [{ name: 'pasta' }],
          }),
        ],
        probably_have: [],
        check_first: [],
      }
    })
    markCooked.mockImplementation(async () => {
      afterCook = true
      return { ok: true, touched: [] }
    })

    render(<Recipes />)
    await screen.findByText('Swipe Fail')
    await cookFromModal('Swipe Fail')

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
    getSuggestions.mockImplementation(async () => {
      callOrder.push('getSuggestions')
      return {
        use_soon_shelf: [],
        cook_tonight: [
          poolCookCard({
            id: '950',
            title: 'Order Test',
            pool_suggestion_id: 'sug-order',
            extendedIngredients: [{ name: 'beans' }],
          }),
        ],
        probably_have: [],
        check_first: [],
      }
    })

    render(<Recipes />)
    await screen.findByText('Order Test')
    await cookFromModal('Order Test')

    await waitFor(() => {
      expect(callOrder.indexOf('markCooked')).toBeGreaterThanOrEqual(0)
      expect(callOrder.indexOf('getDepth')).toBeGreaterThan(callOrder.indexOf('markCooked'))
      const reloads = callOrder.filter((c) => c === 'getSuggestions').length
      expect(reloads).toBeGreaterThan(1)
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
    await cookFromModal('Spinach Pasta')
    await waitFor(() => {
      expect(screen.getByText('Still have these?')).toBeInTheDocument()
      expect(screen.getByText('spinach')).toBeInTheDocument()
    })
    expect(getHealthCard).not.toHaveBeenCalled()
  })

  it('POOL_SHOWS_USE_SOON_ABOVE_COOK_TONIGHT', async () => {
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
      cook_tonight: [
        poolCookCard({ id: '500', title: 'Pool Pasta', pool_suggestion_id: 'sug-1' }),
      ],
      probably_have: [],
      check_first: [],
    })
    render(<Recipes />)
    const useSoonHeader = await screen.findByText("Use before it's gone")
    const readyHeader = await screen.findByText('Cook tonight')
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
    fireEvent.click(screen.getByRole('button', { name: /Pull refresh/i }))
    await waitFor(() => {
      expect(triggerGeneration).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ triggerReason: 'manual_refresh' })
      )
    })
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [recipeStub({ id: 'c2', title: 'New Card' })],
      probably_have: [],
      check_first: [],
    })
    resolveGen({ status: 'completed', suggestions_generated: 1 })
    await screen.findByText('New Card')
    expect(getSuggestions.mock.calls.length).toBeGreaterThan(1)
  })

  it('POOL_COOK_CARD_GONE_AFTER_REMOUNT', async () => {
    let afterCook = false
    getSuggestions.mockImplementation(async () => {
      if (afterCook) return EMPTY_SUGGESTIONS
      return {
        use_soon_shelf: [],
        cook_tonight: [
          poolCookCard({
            id: '500',
            title: 'Remount Soup',
            pool_suggestion_id: 'sug-remount',
            extendedIngredients: [{ name: 'carrot' }],
          }),
        ],
        probably_have: [],
        check_first: [],
      }
    })
    markCooked.mockImplementation(async () => {
      afterCook = true
      return { ok: true, touched: [] }
    })
    const { unmount } = render(<Recipes />)
    await screen.findByText('Remount Soup')
    await cookFromModal('Remount Soup')
    await waitFor(() => expect(markCooked).toHaveBeenCalledTimes(1))
    unmount()
    render(<Recipes />)
    await waitFor(() => expect(getSuggestions.mock.calls.length).toBeGreaterThan(1))
    expect(screen.queryByText('Remount Soup')).not.toBeInTheDocument()
    expect(swipeSuggestion).not.toHaveBeenCalled()
  })

  it('DEV_COOK_LOOP_OBSERVE_LOGS_QA_AFTER_COOK', async () => {
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        poolCookCard({
          id: 'dev_cook_loop',
          title: '[DEV] Cook-loop pasta',
          pool_suggestion_id: 'sug-dev',
          score: 0.9999,
          extendedIngredients: [
            { name: 'pasta' },
            { name: 'tomatoes' },
            { name: 'olive oil' },
            { name: 'rice vinegar' },
          ],
        }),
      ],
      probably_have: [],
      check_first: [],
    })
    markCooked.mockResolvedValue({
      ok: true,
      touched: [
        { base_ingredient: 'pasta' },
        { base_ingredient: 'tomatoes' },
        { base_ingredient: 'olive oil' },
      ],
    })
    render(<Recipes />)
    await screen.findByText('[DEV] Cook-loop pasta')
    await cookFromModal('[DEV] Cook-loop pasta')
    await waitFor(() => expect(devCookLoopReport).toHaveBeenCalled())
    await waitFor(() =>
      expect(postDevLog).toHaveBeenCalledWith(
        'cookLoopQa',
        expect.stringContaining('mode=observe')
      )
    )
  })

  it('SHOW_MORE_AND_SESSION_REFS_RESET_ON_USER_CHANGE', async () => {
    const shelf = (cards) => ({
      use_soon_shelf: [],
      cook_tonight: cards,
      probably_have: [],
      check_first: [],
    })
    getSuggestions.mockImplementation((uid) =>
      Promise.resolve(shelf(uid === 'user-2' ? sixCookTonight('U2') : sixCookTonight('U1')))
    )

    const { rerender } = render(<Recipes />)
    await screen.findByText('U1 Meal 1')
    expect(screen.queryByText('U1 Meal 6')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Show more \(1\)/i }))
    expect(screen.getByText('U1 Meal 6')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Show more/i })).not.toBeInTheDocument()

    await waitFor(() => {
      expect(emit).toHaveBeenCalledWith('funnel_first_suggestion_viewed', 'user-1')
    })
    emit.mockClear()

    mockAuthUser.current = { id: 'user-2', email: 'u2@example.com' }
    rerender(<Recipes />)

    await screen.findByText('U2 Meal 1')
    expect(screen.queryByText('U1 Meal 1')).not.toBeInTheDocument()
    expect(screen.queryByText('U2 Meal 6')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Show more \(1\)/i })).toBeInTheDocument()
    await waitFor(() => {
      expect(emit).toHaveBeenCalledWith('funnel_first_suggestion_viewed', 'user-2')
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
        onDismiss={vi.fn()}
        onExpand={vi.fn()}
      />
    )
    expect(screen.queryByText(/Check before cooking/)).not.toBeInTheDocument()
  })

  it('SWIPE_OVERLAY_SAYS_NOT_TONIGHT', () => {
    render(
      <SuggestionRecipeCard
        recipe={recipeStub({ title: 'Swipe Copy' })}
        onDismiss={vi.fn()}
        onExpand={vi.fn()}
      />
    )
    expect(screen.getAllByText('Not tonight').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Don't have this/i)).not.toBeInTheDocument()
  })

  it('SKIPPED_OVERLAY_USES_ERROR_TOKEN', () => {
    const { container } = render(
      <SuggestionRecipeCard
        recipe={recipeStub({ title: 'Swipe Copy' })}
        onDismiss={vi.fn()}
        onExpand={vi.fn()}
      />
    )
    const overlay = container.querySelector('[style*="color-mix"]')
    expect(overlay).toBeTruthy()
    expect(overlay?.className || '').not.toMatch(/bg-red-600/)
  })

  it('NOT_TONIGHT_BUTTON_DISMISSES_WITHOUT_EXPAND', () => {
    const onExpand = vi.fn()
    const onDismiss = vi.fn()
    render(
      <SuggestionRecipeCard
        recipe={recipeStub({ title: 'Curry Check' })}
        onDismiss={onDismiss}
        onExpand={onExpand}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /^Not tonight$/i }))
    expect(onDismiss).toHaveBeenCalled()
    expect(onExpand).not.toHaveBeenCalled()
  })

  it('CARD_SHOWS_PHOTO_TIME_AND_USES_LINE', () => {
    render(
      <SuggestionRecipeCard
        recipe={recipeStub({
          title: 'Egg Toast',
          readyInMinutes: 20,
          pantry_highlights: ['eggs', 'bread'],
          image: 'https://img.test/egg.jpg',
        })}
        onDismiss={vi.fn()}
        onExpand={vi.fn()}
      />
    )
    expect(screen.getByText('20 min')).toBeInTheDocument()
    expect(screen.getByText(/Uses eggs and bread/i)).toBeInTheDocument()
  })
})

describe('Dinner picker dismiss', () => {
  beforeEach(() => {
    mockAuthUser.current = { id: 'user-1', email: 't@example.com' }
    getSuggestions.mockClear()
    swipeSuggestion.mockClear()
    dismissSuggestion.mockClear()
    getHousehold.mockResolvedValue({ household: { id: 'h1' } })
    getPantry.mockResolvedValue({ grouped: [] })
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        poolCookCard({ id: '500', title: 'Pool Card', pool_suggestion_id: 'sug-dismiss' }),
      ],
      probably_have: [],
      check_first: [],
    })
  })

  it('DISMISS_USES_POOL_SUGGESTION_ID_NOT_RECIPE_ID', async () => {
    render(<Recipes />)
    await screen.findByText('Pool Card')
    fireEvent.click(screen.getByRole('button', { name: /^Not tonight$/i }))
    await waitFor(() => {
      expect(swipeSuggestion).toHaveBeenCalledWith('user-1', 'sug-dismiss', 'h1')
    })
    expect(dismissSuggestion).not.toHaveBeenCalled()
  })

  it('DISMISS_NETWORK_ERROR_RESTORES_CARD', async () => {
    swipeSuggestion.mockRejectedValueOnce(new Error('network'))
    render(<Recipes />)
    await screen.findByText('Pool Card')
    fireEvent.click(screen.getByRole('button', { name: /^Not tonight$/i }))
    await waitFor(() => {
      expect(screen.getByText('Pool Card')).toBeInTheDocument()
    })
  })
})
