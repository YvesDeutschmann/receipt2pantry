import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import GraveyardSection, { relativeRemovalTime } from '../components/GraveyardSection'

function renderGraveyard(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}
import HealthCard from '../components/HealthCard'
import Recipes from '../pages/Recipes'

const mockApi = vi.hoisted(() => ({
  getGraveyard: vi.fn(),
  putBack: vi.fn(),
  getHealthCard: vi.fn(),
  dismissHealthCard: vi.fn(),
  correctPantryItem: vi.fn(),
  getHousehold: vi.fn(),
  getSuggestions: vi.fn(),
  getPantry: vi.fn(),
  markCooked: vi.fn(),
  dismissSuggestion: vi.fn(),
  suggestions: {
    getPool: vi.fn(() =>
      Promise.resolve({
        pool: { breakfast: [], lunch: [], dinner: [] },
        household_id: 'household-1',
      })
    ),
    getDepth: vi.fn(() =>
      Promise.resolve({
        depth: { breakfast: 5, lunch: 5, dinner: 5 },
      })
    ),
    swipe: vi.fn(() => Promise.resolve({ ok: true })),
    triggerGeneration: vi.fn(() => Promise.resolve({ status: 'completed' })),
  },
}))

vi.mock('../services/apiClient', () => ({
  api: mockApi,
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '00000000-0000-0000-0000-000000000001', email: 'test@example.com' },
    session: {},
    loading: false,
  }),
}))

describe('GraveyardSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.getGraveyard.mockReset()
    mockApi.putBack.mockReset()
    mockApi.getGraveyard.mockResolvedValue({ items: [] })
  })

  it('GRAVEYARD_RENDERS_ITEMS: shows rows and relative labels', async () => {
    mockApi.getGraveyard.mockResolvedValue({
      items: [
        {
          depletion_history_id: 'd1',
          pantry_item_id: 'p1',
          base_ingredient: 'spinach',
          deleted_at: new Date().toISOString(),
          reason: 'AUTO_EXPIRED',
          put_back_count: 0,
          sub_class: 'leafy_green',
        },
        {
          depletion_history_id: 'd2',
          pantry_item_id: 'p2',
          base_ingredient: 'milk',
          deleted_at: new Date(Date.now() - 86400000).toISOString(),
          reason: 'AUTO_EXPIRED',
          put_back_count: 0,
          sub_class: 'dairy',
        },
        {
          depletion_history_id: 'd3',
          pantry_item_id: 'p3',
          base_ingredient: 'eggs',
          deleted_at: new Date(Date.now() - 5 * 86400000).toISOString(),
          reason: 'AUTO_EXPIRED',
          put_back_count: 0,
          sub_class: 'dairy',
        },
      ],
    })
    const onPutBack = vi.fn()
    renderGraveyard(
      <GraveyardSection userId="u1" householdId="h1" onPutBack={onPutBack} />
    )
    await waitFor(() => expect(screen.getByText(/Recently Removed/i)).toBeInTheDocument())
    expect(screen.getByText(/Spinach/i)).toBeInTheDocument()
    expect(screen.getByText(/Milk/i)).toBeInTheDocument()
    expect(screen.getByText(/Eggs/i)).toBeInTheDocument()
    expect(screen.getByText(/removed today/i)).toBeInTheDocument()
    expect(screen.getByText(/removed yesterday/i)).toBeInTheDocument()
    expect(screen.getByText(/removed 5 days ago/i)).toBeInTheDocument()
  })

  it('GRAVEYARD_EMPTY_NOT_RENDERED: no header when empty', async () => {
    mockApi.getGraveyard.mockResolvedValue({ items: [] })
    renderGraveyard(<GraveyardSection userId="u1" householdId={null} onPutBack={vi.fn()} />)
    await waitFor(() => expect(mockApi.getGraveyard).toHaveBeenCalled())
    expect(screen.queryByText(/Recently Removed/i)).not.toBeInTheDocument()
  })

  it('GRAVEYARD_PUT_BACK_BUTTON_SHOWN: leafy_green shows Put back', async () => {
    mockApi.getGraveyard.mockResolvedValue({
      items: [
        {
          depletion_history_id: 'd1',
          pantry_item_id: 'p1',
          base_ingredient: 'kale',
          deleted_at: new Date().toISOString(),
          reason: 'AUTO_EXPIRED',
          put_back_count: 0,
          sub_class: 'leafy_green',
        },
      ],
    })
    renderGraveyard(<GraveyardSection userId="u1" householdId={null} onPutBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Put back/i })).toBeInTheDocument())
  })

  it('GRAVEYARD_RAW_MEAT_BLOCKED_NO_BUTTON: raw_meat put_back_count 1 shows Removed', async () => {
    mockApi.getGraveyard.mockResolvedValue({
      items: [
        {
          depletion_history_id: 'd1',
          pantry_item_id: 'p1',
          base_ingredient: 'beef',
          deleted_at: new Date().toISOString(),
          reason: 'AUTO_EXPIRED',
          put_back_count: 1,
          sub_class: 'raw_meat',
        },
      ],
    })
    renderGraveyard(<GraveyardSection userId="u1" householdId={null} onPutBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Removed', { exact: true })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /Put back/i })).not.toBeInTheDocument()
  })

  it('GRAVEYARD_RAW_FISH_BLOCKED_NO_BUTTON: raw_fish put_back_count 1 hides Put back', async () => {
    mockApi.getGraveyard.mockResolvedValue({
      items: [
        {
          depletion_history_id: 'd1',
          pantry_item_id: 'p1',
          base_ingredient: 'salmon',
          deleted_at: new Date().toISOString(),
          reason: 'AUTO_EXPIRED',
          put_back_count: 1,
          sub_class: 'raw_fish',
        },
      ],
    })
    renderGraveyard(<GraveyardSection userId="u1" householdId={null} onPutBack={vi.fn()} />)
    await waitFor(() => expect(screen.queryByRole('button', { name: /Put back/i })).not.toBeInTheDocument())
  })

  it('GRAVEYARD_RAW_MEAT_FIRST_PUT_BACK_ALLOWED: put_back_count 0 shows Put back', async () => {
    mockApi.getGraveyard.mockResolvedValue({
      items: [
        {
          depletion_history_id: 'd1',
          pantry_item_id: 'p1',
          base_ingredient: 'beef',
          deleted_at: new Date().toISOString(),
          reason: 'AUTO_EXPIRED',
          put_back_count: 0,
          sub_class: 'raw_meat',
        },
      ],
    })
    renderGraveyard(<GraveyardSection userId="u1" householdId={null} onPutBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Put back/i })).toBeInTheDocument())
  })

  it('GRAVEYARD_NON_MEAT_MULTIPLE_PUT_BACKS: high put_back_count still shows Put back', async () => {
    mockApi.getGraveyard.mockResolvedValue({
      items: [
        {
          depletion_history_id: 'd1',
          pantry_item_id: 'p1',
          base_ingredient: 'lettuce',
          deleted_at: new Date().toISOString(),
          reason: 'AUTO_EXPIRED',
          put_back_count: 3,
          sub_class: 'leafy_green',
        },
      ],
    })
    renderGraveyard(<GraveyardSection userId="u1" householdId={null} onPutBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Put back/i })).toBeInTheDocument())
  })

  it('GRAVEYARD_USE_TONIGHT_PROMPT_FIRST_ONLY: hint only on first row', async () => {
    mockApi.getGraveyard.mockResolvedValue({
      items: [
        {
          depletion_history_id: 'd1',
          pantry_item_id: 'p1',
          base_ingredient: 'apricot',
          deleted_at: new Date().toISOString(),
          reason: 'AUTO_EXPIRED',
          put_back_count: 0,
          sub_class: 'leafy_green',
        },
        {
          depletion_history_id: 'd2',
          pantry_item_id: 'p2',
          base_ingredient: 'b',
          deleted_at: new Date(Date.now() - 86400000).toISOString(),
          reason: 'AUTO_EXPIRED',
          put_back_count: 0,
          sub_class: 'leafy_green',
        },
        {
          depletion_history_id: 'd3',
          pantry_item_id: 'p3',
          base_ingredient: 'c',
          deleted_at: new Date(Date.now() - 2 * 86400000).toISOString(),
          reason: 'AUTO_EXPIRED',
          put_back_count: 0,
          sub_class: 'leafy_green',
        },
      ],
    })
    renderGraveyard(<GraveyardSection userId="u1" householdId={null} onPutBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/^Apricot$/i)).toBeInTheDocument())
    const hints = screen.queryAllByText(/recipes to use it tonight/i)
    expect(hints.length).toBe(1)
  })

  it('GRAVEYARD_PUT_BACK_CALLS_API: putBack, onPutBack, removes row', async () => {
    mockApi.putBack.mockResolvedValue({ ok: true })
    mockApi.getGraveyard.mockResolvedValue({
      items: [
        {
          depletion_history_id: 'd1',
          pantry_item_id: 'p1',
          base_ingredient: 'spinach',
          deleted_at: new Date().toISOString(),
          reason: 'AUTO_EXPIRED',
          put_back_count: 0,
          sub_class: 'leafy_green',
        },
      ],
    })
    const onPutBack = vi.fn()
    renderGraveyard(<GraveyardSection userId="u1" householdId={null} onPutBack={onPutBack} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Put back/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Put back/i }))
    await waitFor(() => expect(mockApi.putBack).toHaveBeenCalledWith('u1', 'd1'))
    await waitFor(() => expect(onPutBack).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText(/Spinach/i)).not.toBeInTheDocument())
  })

  it('GRAVEYARD_PUT_BACK_409_SILENT: item stays', async () => {
    mockApi.putBack.mockRejectedValue({ response: { status: 409 } })
    mockApi.getGraveyard.mockResolvedValue({
      items: [
        {
          depletion_history_id: 'd1',
          pantry_item_id: 'p1',
          base_ingredient: 'spinach',
          deleted_at: new Date().toISOString(),
          reason: 'AUTO_EXPIRED',
          put_back_count: 0,
          sub_class: 'leafy_green',
        },
      ],
    })
    renderGraveyard(<GraveyardSection userId="u1" householdId={null} onPutBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/Spinach/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Put back/i }))
    await waitFor(() => expect(mockApi.putBack).toHaveBeenCalled())
    expect(screen.getByText(/Spinach/i)).toBeInTheDocument()
  })
})

describe('relativeRemovalTime', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('GRAVEYARD_RELATIVE_TIME_TODAY', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-15T12:00:00.000Z'))
    expect(relativeRemovalTime('2026-04-15T08:00:00.000Z')).toBe('removed today')
  })

  it('GRAVEYARD_RELATIVE_TIME_DAYS_AGO', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-15T12:00:00.000Z'))
    expect(relativeRemovalTime('2026-04-12T12:00:00.000Z')).toBe('removed 3 days ago')
  })
})

describe('HealthCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.dismissHealthCard.mockResolvedValue({})
    mockApi.correctPantryItem.mockResolvedValue({ ok: true })
  })

  const sampleItems = [
    {
      item_id: 'i1',
      base_ingredient: 'olive oil',
      normalized_name: 'Extra Virgin Olive Oil',
      confidence: 0.35,
      depletion_class: 'CONSUMABLE',
    },
    {
      item_id: 'i2',
      base_ingredient: 'paprika',
      normalized_name: 'Paprika',
      confidence: 0.4,
      depletion_class: 'CONSUMABLE',
    },
    {
      item_id: 'i3',
      base_ingredient: 'soy sauce',
      normalized_name: 'Soy Sauce',
      confidence: 0.45,
      depletion_class: 'CONSUMABLE',
    },
  ]

  it('HEALTH_CARD_RENDERS_ITEMS', () => {
    render(
      <HealthCard
        userId="u1"
        items={sampleItems}
        visible
        onDismiss={vi.fn()}
        onItemUpdated={vi.fn()}
      />
    )
    expect(screen.getByText(/Quick pantry check/i)).toBeInTheDocument()
    expect(screen.getByText(/30 seconds/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Still have it/i })).toHaveLength(3)
    expect(screen.getByRole('button', { name: /Done, thanks/i })).toBeInTheDocument()
  })

  it('HEALTH_CARD_NOT_VISIBLE', () => {
    render(
      <HealthCard
        userId="u1"
        items={sampleItems}
        visible={false}
        onDismiss={vi.fn()}
        onItemUpdated={vi.fn()}
      />
    )
    expect(screen.queryByText(/Quick pantry check/i)).not.toBeInTheDocument()
  })

  it('HEALTH_CARD_STILL_HAVE_IT', async () => {
    render(
      <HealthCard
        userId="u1"
        items={[sampleItems[0]]}
        visible
        onDismiss={vi.fn()}
        onItemUpdated={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Still have it/i }))
    await waitFor(() =>
      expect(mockApi.correctPantryItem).toHaveBeenCalledWith('u1', 'i1', 'still_have_it')
    )
  })

  it('HEALTH_CARD_REMOVE_ITEM', async () => {
    render(
      <HealthCard
        userId="u1"
        items={[sampleItems[1]]}
        visible
        onDismiss={vi.fn()}
        onItemUpdated={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Used it up/i }))
    await waitFor(() =>
      expect(mockApi.correctPantryItem).toHaveBeenCalledWith('u1', 'i2', 'used_it_up')
    )
  })

  it('HEALTH_CARD_DISMISS', async () => {
    const onDismiss = vi.fn()
    render(
      <HealthCard
        userId="u1"
        items={sampleItems}
        visible
        onDismiss={onDismiss}
        onItemUpdated={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Done, thanks/i }))
    await waitFor(() => expect(mockApi.dismissHealthCard).toHaveBeenCalledWith('u1'))
    await waitFor(() => expect(onDismiss).toHaveBeenCalled())
  })

  it('HEALTH_CARD_AUTO_DISMISS_WHEN_EMPTY', async () => {
    const onDismiss = vi.fn()
    const onItemUpdated = vi.fn().mockResolvedValue(undefined)
    render(
      <HealthCard
        userId="u1"
        items={[sampleItems[0]]}
        visible
        onDismiss={onDismiss}
        onItemUpdated={onItemUpdated}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Still have it/i }))
    await waitFor(() => expect(mockApi.correctPantryItem).toHaveBeenCalled())
    await waitFor(
      () => {
        expect(mockApi.dismissHealthCard).toHaveBeenCalled()
        expect(onDismiss).toHaveBeenCalled()
      },
      { timeout: 3000 }
    )
  })

  it('HEALTH_CARD_MAX_FIVE_ITEMS', () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({
      item_id: `x${i}`,
      base_ingredient: `item ${i}`,
      normalized_name: `Item ${i}`,
      confidence: 0.3,
      depletion_class: 'CONSUMABLE',
    }))
    render(
      <HealthCard userId="u1" items={seven} visible onDismiss={vi.fn()} onItemUpdated={vi.fn()} />
    )
    expect(screen.getAllByRole('button', { name: /Still have it/i })).toHaveLength(5)
  })
})

describe('Recipes health card after cook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.getHousehold.mockReset()
    mockApi.getSuggestions.mockReset()
    mockApi.getPantry.mockReset()
    mockApi.markCooked.mockReset()
    mockApi.getHealthCard.mockReset()
    mockApi.suggestions.getPool.mockReset()
    mockApi.suggestions.getPool.mockResolvedValue({
      pool: { breakfast: [], lunch: [], dinner: [] },
      household_id: 'household-1',
    })
    mockApi.getHousehold.mockResolvedValue({
      household: { id: 'household-1', suggestion_meal_slots: { breakfast: true, lunch: true, dinner: true } },
    })
    mockApi.getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [
        {
          id: 'recipe-1',
          title: 'Test Pasta',
          servings: 2,
          ingredient_flags: [{ ingredient_name: 'Pasta' }],
        },
      ],
      probably_have: [],
      check_first: [],
    })
    mockApi.getPantry.mockResolvedValue({ grouped: [], items: [] })
    mockApi.markCooked.mockResolvedValue({ ok: true })
    mockApi.getHealthCard.mockResolvedValue({
      show: true,
      items: [
        {
          item_id: 'hc1',
          base_ingredient: 'oil',
          normalized_name: 'Olive oil',
          confidence: 0.3,
          depletion_class: 'CONSUMABLE',
        },
      ],
    })
  })

  it('HEALTH_CARD_AFTER_COOK_EVENT', async () => {
    render(<Recipes />)
    await waitFor(() => expect(screen.getByText(/Test Pasta/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Cooked it/i }))
    await waitFor(() => expect(mockApi.markCooked).toHaveBeenCalled())
    await waitFor(() => expect(mockApi.getHealthCard).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText(/Quick pantry check/i)).toBeInTheDocument())
  })
})
