import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { groupByConfidence, getStatusLabel } from '../utils/pantryConfidence'
import PantryList from '../components/PantryList'
import Pantry from '../pages/Pantry'

function renderPantry() {
  return render(
    <MemoryRouter>
      <Pantry />
    </MemoryRouter>
  )
}

vi.mock('../contexts/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({
    user: {
      id: 'user-1',
      email: 'test@example.com',
      user_metadata: { onboarding_completed_at: '2026-01-01' },
    },
    session: {},
    loading: false,
    onboardingComplete: true,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    signInWithApple: vi.fn(),
    signInWithGoogle: vi.fn(),
  }),
}))

vi.mock('../services/apiClient', () => ({
  api: {
    getPantry: vi.fn(),
    getHousehold: vi.fn(),
    correctPantryItem: vi.fn(),
    getGraveyard: vi.fn(),
    putBack: vi.fn(),
    getSuggestions: vi.fn(() =>
      Promise.resolve({
        use_soon_shelf: [],
        cook_tonight: [],
        probably_have: [],
        check_first: [],
      })
    ),
    markCooked: vi.fn(),
    dismissSuggestion: vi.fn(),
    getHealthCard: vi.fn(() => Promise.resolve({ show: false, items: [] })),
    dismissHealthCard: vi.fn(() => Promise.resolve({})),
  },
}))

/** Lightweight stand-in so we do not override the global `framer-motion` mock used by other test files. */
vi.mock('../components/PantryItem', async () => {
  const { getStatusLabel } = await import('../utils/pantryConfidence')
  return {
    default: function PantryItemStub({
      item,
      onRemove,
      onCorrection,
      correctionOpen,
      onToggleCorrection,
    }) {
      const isFaded = (item.confidence ?? 0) < 0.2
      const displayName = item.normalized_name || item.base_ingredient || ''
      const label = getStatusLabel(item)
      return (
        <div className={isFaded ? 'opacity-50' : ''} data-testid="pantry-item-stub">
          <div className="flex items-start justify-between gap-3">
            <span>{displayName}</span>
            <span>{label}</span>
          </div>
          <button type="button" data-testid="pantry-motion-div" onClick={() => onToggleCorrection?.()}>
            open row
          </button>
          <button type="button" data-testid="trigger-swipe-remove" onClick={() => onRemove(item.id)}>
            sim swipe
          </button>
          {correctionOpen ? (
            <div onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
              <button type="button" onClick={() => void onCorrection(item.id, 'still_have_it')}>
                Still have it
              </button>
              <button type="button" onClick={() => void onCorrection(item.id, 'used_it_up')}>
                Used it up
              </button>
              <button type="button" onClick={() => void onCorrection(item.id, 'never_had_it')}>
                Never had it
              </button>
            </div>
          ) : null}
        </div>
      )
    },
  }
})

import { api } from '../services/apiClient'

let _itemSeq = 0

function item(overrides) {
  _itemSeq += 1
  return {
    base_ingredient: 'x',
    normalized_name: 'X',
    variant: null,
    category: 'Other',
    quantity: 1,
    unit: 'count',
    depletion_class: 'CONSUMABLE',
    confidence: 0.9,
    is_frozen: false,
    use_soon: false,
    put_back_count: 0,
    is_soft_required: false,
    ...overrides,
    id: overrides.id ?? `test-item-${_itemSeq}`,
  }
}

describe('PantryView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.getHousehold.mockResolvedValue({ household: { id: 'hh-1' } })
    api.getGraveyard.mockResolvedValue({ items: [] })
    api.putBack.mockResolvedValue({ ok: true, item: {} })
  })

  it('CONFIDENCE_GROUPING_CORRECT', () => {
    const items = [
      item({ id: 'a', confidence: 0.95, base_ingredient: 'a' }),
      item({ id: 'b', confidence: 0.6, base_ingredient: 'b' }),
      item({ id: 'c', confidence: 0.35, base_ingredient: 'c' }),
      item({ id: 'd', confidence: 0.1, base_ingredient: 'd' }),
    ]
    const g = groupByConfidence(items)
    expect(g.map((x) => x.label)).toEqual(['FRESH', 'GETTING LOW', 'UNCERTAIN', 'LIKELY GONE'])
    render(
      <PantryList items={items} onCorrection={vi.fn()} onRemove={vi.fn()} />
    )
    expect(screen.getByText('FRESH')).toBeInTheDocument()
    expect(screen.getByText('GETTING LOW')).toBeInTheDocument()
    expect(screen.getByText('UNCERTAIN')).toBeInTheDocument()
    expect(screen.getByText('LIKELY GONE')).toBeInTheDocument()
  })

  it('EMPTY_TIER_NOT_RENDERED', () => {
    const items = [
      item({ id: 'a', confidence: 0.95 }),
      item({ id: 'b', confidence: 0.9 }),
    ]
    render(<PantryList items={items} onCorrection={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByText('FRESH')).toBeInTheDocument()
    expect(screen.queryByText('GETTING LOW')).not.toBeInTheDocument()
    expect(screen.queryByText('UNCERTAIN')).not.toBeInTheDocument()
    expect(screen.queryByText('LIKELY GONE')).not.toBeInTheDocument()
  })

  it('STATUS_LABEL_PERISHABLE_FRESH', () => {
    expect(
      getStatusLabel(
        item({ depletion_class: 'PERISHABLE', confidence: 0.9, use_soon: false, is_soft_required: false })
      )
    ).toBe('Fresh')
  })

  it('STATUS_LABEL_PERISHABLE_USE_SOON', () => {
    expect(
      getStatusLabel(
        item({ depletion_class: 'PERISHABLE', confidence: 0.55, use_soon: false, is_soft_required: false })
      )
    ).toBe('Use soon')
  })

  it('STATUS_LABEL_CONSUMABLE_IN_STOCK', () => {
    expect(
      getStatusLabel(
        item({ depletion_class: 'CONSUMABLE', confidence: 0.85, use_soon: false, is_soft_required: false })
      )
    ).toBe('In stock')
  })

  it('STATUS_LABEL_CONSUMABLE_GETTING_LOW', () => {
    expect(
      getStatusLabel(
        item({ depletion_class: 'CONSUMABLE', confidence: 0.55, use_soon: false, is_soft_required: false })
      )
    ).toBe('Getting low')
  })

  it('STATUS_LABEL_SPICE', () => {
    expect(
      getStatusLabel(
        item({ is_soft_required: true, confidence: 0.6, depletion_class: 'CONSUMABLE' })
      )
    ).toBe('Check spice rack')
  })

  it('STATUS_LABEL_LIKELY_GONE_FADED', () => {
    const { container } = render(
      <PantryList
        items={[item({ id: 'fade-1', confidence: 0.1, depletion_class: 'CONSUMABLE' })]}
        onCorrection={vi.fn()}
        onRemove={vi.fn()}
      />
    )
    const row = container.querySelector('.opacity-50')
    expect(row).toBeTruthy()
  })

  it('SWIPE_TO_REMOVE_CALLS_API', async () => {
    api.correctPantryItem.mockResolvedValue({ ok: true })
    api.getPantry.mockResolvedValue({
      total_items: 1,
      unique_ingredients: 1,
      items: [item({ id: 'swipe-1', confidence: 0.95, normalized_name: 'Swipe Me' })],
      grouped: [],
      household_id: null,
    })
    renderPantry()
    await screen.findByText('Swipe Me')
    fireEvent.click(screen.getByTestId('trigger-swipe-remove'))
    expect(api.correctPantryItem).toHaveBeenCalledWith('user-1', 'swipe-1', 'used_it_up')
  })

  it('TAP_OPENS_CORRECTION', () => {
    render(
      <PantryList
        items={[item({ id: 'x1', confidence: 0.95, normalized_name: 'Olive Oil' })]}
        onCorrection={vi.fn()}
        onRemove={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('pantry-motion-div'))
    expect(screen.getByRole('button', { name: /still have it/i })).toBeInTheDocument()
  })

  it('CORRECTION_STILL_HAVE_IT', () => {
    api.correctPantryItem.mockResolvedValue({ ok: true })
    const onCorrection = vi.fn().mockResolvedValue(undefined)
    render(
      <PantryList
        items={[item({ id: 'c1', confidence: 0.5 })]}
        onCorrection={onCorrection}
        onRemove={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('pantry-motion-div'))
    fireEvent.click(screen.getByRole('button', { name: /still have it/i }))
    expect(onCorrection).toHaveBeenCalledWith('c1', 'still_have_it')
  })

  it('CORRECTION_USED_IT_UP', () => {
    api.correctPantryItem.mockResolvedValue({ ok: true })
    const onCorrection = vi.fn().mockResolvedValue(undefined)
    render(
      <PantryList
        items={[item({ id: 'c2', confidence: 0.5 })]}
        onCorrection={onCorrection}
        onRemove={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('pantry-motion-div'))
    fireEvent.click(screen.getByRole('button', { name: /used it up/i }))
    expect(onCorrection).toHaveBeenCalledWith('c2', 'used_it_up')
  })

  it('CORRECTION_NEVER_HAD_IT', () => {
    const onCorrection = vi.fn().mockResolvedValue(undefined)
    render(
      <PantryList
        items={[item({ id: 'c3', confidence: 0.5 })]}
        onCorrection={onCorrection}
        onRemove={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('pantry-motion-div'))
    fireEvent.click(screen.getByRole('button', { name: /never had it/i }))
    expect(onCorrection).toHaveBeenCalledWith('c3', 'never_had_it')
  })

  it('NO_QUANTITY_CONTROLS', () => {
    render(
      <PantryList
        items={[item({ id: 'q1', quantity: 2, unit: 'lb' })]}
        onCorrection={vi.fn()}
        onRemove={vi.fn()}
      />
    )
    expect(document.querySelector('input[type="number"]')).toBeNull()
    expect(screen.queryByTitle('Increase')).toBeNull()
    expect(screen.queryByTitle('Decrease')).toBeNull()
    expect(screen.queryByText(/2\.00\s*lb/)).toBeNull()
  })

  it('SEARCH_FILTERS_BEFORE_GROUPING', async () => {
    api.getPantry.mockResolvedValue({
      total_items: 2,
      unique_ingredients: 2,
      items: [
        item({
          id: 'i1',
          base_ingredient: 'chicken breast',
          normalized_name: 'Chicken Breast',
          confidence: 0.95,
        }),
        item({
          id: 'i2',
          base_ingredient: 'olive oil',
          normalized_name: 'olive oil',
          confidence: 0.35,
        }),
      ],
      grouped: [],
      household_id: null,
    })
    renderPantry()
    await screen.findByText('FRESH')
    expect(screen.getByText('UNCERTAIN')).toBeInTheDocument()
    const search = screen.getByPlaceholderText('Search pantry...')
    fireEvent.change(search, { target: { value: 'olive' } })
    expect(screen.queryByText('FRESH')).not.toBeInTheDocument()
    expect(screen.getByText('UNCERTAIN')).toBeInTheDocument()
    expect(screen.getByText('olive oil', { exact: false })).toBeInTheDocument()
  })

  it('GRAVEYARD_AT_BOTTOM', async () => {
    api.getPantry.mockResolvedValue({
      total_items: 1,
      unique_ingredients: 1,
      items: [item({ id: 'g0', confidence: 0.9, normalized_name: 'A' })],
      grouped: [],
      household_id: null,
    })
    api.getGraveyard.mockResolvedValue({
      items: [
        {
          depletion_history_id: 'dh1',
          pantry_item_id: 'p1',
          base_ingredient: 'spinach',
          deleted_at: new Date().toISOString(),
          reason: 'AUTO_EXPIRED',
          put_back_count: 0,
          sub_class: null,
        },
      ],
    })
    const { container } = renderPantry()
    await screen.findByText('Recently Removed')
    await screen.findByText('FRESH')
    const fresh = screen.getByText('FRESH')
    const grave = screen.getByText('Recently Removed')
    expect(
      fresh.compareDocumentPosition(grave) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('ITEM_SHOWS_NORMALIZED_NAME', () => {
    render(
      <PantryList
        items={[
          item({
            id: 'n1',
            normalized_name: 'Boneless Chicken Breast',
            base_ingredient: 'chicken breast',
            confidence: 0.9,
          }),
        ]}
        onCorrection={vi.fn()}
        onRemove={vi.fn()}
      />
    )
    expect(screen.getByText('Boneless Chicken Breast')).toBeInTheDocument()
  })
})
