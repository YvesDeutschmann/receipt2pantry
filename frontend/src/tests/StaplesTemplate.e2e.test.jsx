import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React, { useState, useEffect, useMemo, useContext, createContext } from 'react'
import { render, screen, within, waitFor, act, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { expectNotBlocked } from './helpers/invariants'
import OnboardingRoute from '../components/OnboardingRoute'
import StaplesTemplate from '../pages/onboarding/StaplesTemplate'

const { hapticImpact } = vi.hoisted(() => ({
  hapticImpact: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: (...a) => hapticImpact(...a) },
  ImpactStyle: { Light: 'LIGHT' },
}))

const mockApi = vi.hoisted(() => ({
  getHousehold: vi.fn().mockResolvedValue({
    household: {
      id: 'household-test',
      size: 2,
      dietary_restrictions: [],
    },
  }),
  createHousehold: vi.fn(),
  getStaplesTemplate: vi.fn(),
  getStaplesReceiptMatches: vi.fn(),
  confirmStaples: vi.fn(),
  getPantry: vi.fn().mockResolvedValue({ grouped: [] }),
  suggestions: { triggerGeneration: vi.fn().mockResolvedValue({}) },
}))

vi.mock('../services/apiClient', () => ({ api: mockApi }))

const authSnapshot = vi.hoisted(() => ({
  onboardingComplete: false,
  user: {
    id: 'user-1',
    app_metadata: { provider: 'email' },
    user_metadata: {},
  },
  loading: false,
}))

let bumpAuth = () => {}

const mockUpdateUser = vi.hoisted(() =>
  vi.fn((payload) => {
    if (payload?.data?.onboarding_completed_at) {
      authSnapshot.onboardingComplete = true
      authSnapshot.user = {
        ...authSnapshot.user,
        user_metadata: {
          ...authSnapshot.user.user_metadata,
          ...payload.data,
        },
      }
      bumpAuth()
    }
    return Promise.resolve({
      data: {
        user: {
          user_metadata: { ...(payload?.data || {}) },
        },
      },
      error: null,
    })
  })
)

vi.mock('../services/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      updateUser: (...args) => mockUpdateUser(...args),
    },
  },
}))

const AuthTestContext = createContext(null)

vi.mock('../contexts/AuthContext', () => ({
  AuthProvider: ({ children }) => {
    const [onboardingComplete, setOnboardingComplete] = useState(false)
    useEffect(() => {
      bumpAuth = () => setOnboardingComplete(true)
      return () => {
        bumpAuth = () => {}
      }
    }, [])
    const value = useMemo(
      () => ({
        user: authSnapshot.user,
        session: { provider: 'email' },
        loading: authSnapshot.loading,
        onboardingComplete,
        signOut: vi.fn().mockResolvedValue(undefined),
      }),
      [onboardingComplete]
    )
    return <AuthTestContext.Provider value={value}>{children}</AuthTestContext.Provider>
  },
  useAuth: () => useContext(AuthTestContext),
}))

const coldStart = vi.hoisted(() => ({
  setReceiptSyncStatus: vi.fn(),
  setReceiptMatchCount: vi.fn(),
}))

vi.mock('../contexts/ColdStartContext', () => ({
  useColdStart: () => coldStart,
}))

vi.mock('../components/PantrySearchOverlay', () => ({
  default: function PantrySearchOverlayMock() {
    return null
  },
}))

vi.mock('../components/voice/VoiceInputSheet', () => ({
  default: function VoiceInputSheetMock() {
    return null
  },
}))

import { AuthProvider } from '../contexts/AuthContext'

/** 14 items, 6 pre-selected — matches S1-01/S1-03 fixture */
const template = {
  categories: [
    {
      name: 'Oils & Vinegars',
      items: [
        { id: '1', base_ingredient: 'olive oil', display_name: 'Olive oil', pre_selected: true },
        { id: '2', base_ingredient: 'vegetable oil', display_name: 'Vegetable oil', pre_selected: false },
        { id: '3', base_ingredient: 'soy sauce', display_name: 'Soy sauce', pre_selected: false },
      ],
    },
    {
      name: 'Spices & Seasonings',
      items: [
        { id: '4', base_ingredient: 'salt', display_name: 'Salt', pre_selected: true },
        { id: '5', base_ingredient: 'black pepper', display_name: 'Black pepper', pre_selected: true },
        { id: '6', base_ingredient: 'garlic', display_name: 'Garlic', pre_selected: true },
        { id: '7', base_ingredient: 'cinnamon', display_name: 'Cinnamon', pre_selected: false },
        { id: '8', base_ingredient: 'paprika', display_name: 'Paprika', pre_selected: false },
      ],
    },
    {
      name: 'Baking Basics',
      items: [
        { id: '9', base_ingredient: 'sugar', display_name: 'Sugar', pre_selected: true },
        { id: '10', base_ingredient: 'flour', display_name: 'Flour', pre_selected: true },
        { id: '11', base_ingredient: 'baking soda', display_name: 'Baking soda', pre_selected: false },
        { id: '12', base_ingredient: 'vanilla', display_name: 'Vanilla', pre_selected: false },
        { id: '13', base_ingredient: 'brown sugar', display_name: 'Brown sugar', pre_selected: false },
        { id: '14', base_ingredient: 'yeast', display_name: 'Yeast', pre_selected: false },
      ],
    },
  ],
}

function renderStaples() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/onboarding/pantry-setup']}>
        <Routes>
          <Route path="/onboarding" element={<OnboardingRoute />}>
            <Route path="pantry-setup" element={<StaplesTemplate />} />
          </Route>
          <Route path="/recipes" element={<div data-testid="recipes-dest">Recipes</div>} />
          <Route path="/onboarding/bridge" element={<div data-testid="bridge-dest">Bridge</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  )
}

async function confirmToPayoff() {
  renderStaples()
  await screen.findByText('Olive oil')
  mockApi.confirmStaples.mockResolvedValueOnce({ receipt_matched: 0, added: 6 })
  fireEvent.click(screen.getByRole('button', { name: /Done/i }))
  await screen.findByText(/You're all set/i)
}

function installUpdateUserMock() {
  mockUpdateUser.mockImplementation((payload) => {
    if (payload?.data?.onboarding_completed_at) {
      authSnapshot.onboardingComplete = true
      authSnapshot.user = {
        ...authSnapshot.user,
        user_metadata: {
          ...authSnapshot.user.user_metadata,
          ...payload.data,
        },
      }
      bumpAuth()
    }
    return Promise.resolve({
      data: {
        user: {
          user_metadata: { ...(payload?.data || {}) },
        },
      },
      error: null,
    })
  })
}

beforeEach(() => {
  authSnapshot.onboardingComplete = false
  authSnapshot.user = {
    id: 'user-1',
    app_metadata: { provider: 'email' },
    user_metadata: {},
  }
  mockApi.getStaplesTemplate.mockResolvedValue(template)
  mockApi.getStaplesReceiptMatches.mockResolvedValue({ matches: [] })
  mockApi.confirmStaples.mockReset()
  mockApi.confirmStaples.mockResolvedValue({ receipt_matched: 0, added: 6 })
  mockApi.getPantry.mockResolvedValue({ grouped: [] })
  mockApi.suggestions.triggerGeneration.mockClear()
  mockUpdateUser.mockClear()
  installUpdateUserMock()
  hapticImpact.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('StaplesTemplate cold-start E2E', () => {
  it('ARC-01 / 1.1 / S1-01 / S1-02 / S1-03: golden path — defaults, haptics, batch, payoff then complete', async () => {
    renderStaples()
    await screen.findByText('Olive oil')

    for (const name of ['Olive oil', 'Salt', 'Black pepper', 'Garlic', 'Sugar', 'Flour']) {
      const row = screen.getByText(name).closest('button')
      expect(within(row).getByText(/We assumed you have these/i)).toBeInTheDocument()
    }

    mockApi.confirmStaples.mockResolvedValueOnce({ receipt_matched: 0, added: 6 })
    const doneBtn = screen.getByRole('button', { name: /Done/i })
    fireEvent.click(doneBtn)

    await screen.findByText(/You're all set/i)
    expect(mockUpdateUser).not.toHaveBeenCalled()
    expect(mockApi.suggestions.triggerGeneration).toHaveBeenCalledWith('user-1', {
      triggerReason: 'onboarding',
    })

    expect(mockApi.confirmStaples).toHaveBeenCalledTimes(1)
    const [, selected, skip] = mockApi.confirmStaples.mock.calls[0]
    expect(selected).toHaveLength(6)
    expect(selected).toEqual(
      expect.arrayContaining([
        'olive oil',
        'salt',
        'black pepper',
        'garlic',
        'sugar',
        'flour',
      ])
    )
    expect(skip).toBe(false)
    expect(screen.queryByTestId('bridge-dest')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /What's for (Breakfast|Lunch|Dinner)/i }))
    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboarding_completed_at: expect.any(String),
          }),
        })
      )
    })
    await waitFor(() => {
      expect(screen.getByTestId('recipes-dest')).toBeInTheDocument()
    })
  })

  it('CONFIRM_DOES_NOT_WRITE_ONBOARDING_COMPLETED_AT', async () => {
    await confirmToPayoff()
    expect(mockUpdateUser).not.toHaveBeenCalled()
    expect(screen.queryByTestId('recipes-dest')).not.toBeInTheDocument()
  })

  it('CONFIRM_WARMS_SUGGESTION_POOL', async () => {
    await confirmToPayoff()
    expect(mockApi.suggestions.triggerGeneration).toHaveBeenCalledWith('user-1', {
      triggerReason: 'onboarding',
    })
  })

  it('PAYOFF_TAP_WRITES_COMPLETED_AND_NAVIGATES_RECIPES', async () => {
    await confirmToPayoff()
    fireEvent.click(screen.getByRole('button', { name: /What's for (Breakfast|Lunch|Dinner)/i }))
    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboarding_completed_at: expect.any(String),
          }),
        })
      )
    })
    await waitFor(() => {
      expect(screen.getByTestId('recipes-dest')).toBeInTheDocument()
    })
  })

  it('ARC-02: remount resets template selection to API defaults (partial draft not persisted — prod gap)', async () => {
    const { unmount } = renderStaples()
    await screen.findByText('Olive oil')

    fireEvent.click(screen.getByText('Black pepper'))
    const rowBefore = screen.getByText('Black pepper').closest('button')
    expect(within(rowBefore).queryByText(/We assumed you have these/i)).not.toBeInTheDocument()

    unmount()

    renderStaples()
    await screen.findByText('Olive oil')

    expect(screen.getByTestId('cold-start-progress')).toBeInTheDocument()

    const rowAfter = screen.getByText('Black pepper').closest('button')
    expect(within(rowAfter).getByText(/We assumed you have these/i)).toBeInTheDocument()
  })

  it('ARC-03 / 1.4: Done not blocked while receipt sync polls empty', async () => {
    mockApi.getStaplesReceiptMatches.mockResolvedValue({ matches: [] })
    mockApi.confirmStaples.mockResolvedValue({ receipt_matched: 0, added: 6 })

    renderStaples()
    await screen.findByText('Olive oil')

    const done = screen.getByRole('button', { name: /Done/i })
    expectNotBlocked(done)

    fireEvent.click(done)
    await screen.findByText(/You're all set/i)
    expect(mockUpdateUser).not.toHaveBeenCalled()
  })

  it('ARC-04 / 1.3: two receipt matches, badges, single batch, toast', async () => {
    mockApi.getStaplesReceiptMatches
      .mockResolvedValueOnce({ matches: [] })
      .mockResolvedValue({ matches: ['olive oil', 'garlic'] })
    mockApi.confirmStaples.mockResolvedValue({ receipt_matched: 2, added: 6 })

    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderStaples()
      await screen.findByText('Olive oil')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000)
      })

      for (const label of ['Olive oil', 'Garlic']) {
        const row = screen.getByText(label).closest('button')
        await waitFor(() => {
          expect(within(row).getByTitle('Matched a recent receipt')).toBeInTheDocument()
        })
      }

      fireEvent.click(screen.getByRole('button', { name: /Done/i }))
      expect(mockApi.confirmStaples).toHaveBeenCalledTimes(1)
      await screen.findByText(/We matched 2 of your staples to your recent receipts/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('1.2 / S1-05 Skip: six defaults only, skip flag, payoff not auto-home', async () => {
    renderStaples()
    await screen.findByText('Olive oil')

    fireEvent.click(screen.getByRole('button', { name: /Skip for now/i }))

    await screen.findByText(/You're all set/i)
    expect(mockUpdateUser).not.toHaveBeenCalled()
    expect(screen.queryByTestId('recipes-dest')).not.toBeInTheDocument()

    expect(mockApi.confirmStaples).toHaveBeenCalledTimes(1)
    const [, selected, skipFlag] = mockApi.confirmStaples.mock.calls[0]
    expect(selected).toHaveLength(6)
    expect(selected).toEqual(
      expect.arrayContaining([
        'olive oil',
        'salt',
        'black pepper',
        'garlic',
        'sugar',
        'flour',
      ])
    )
    expect(skipFlag).toBe(true)
  })

  it('1.5 / S1-04: Back with changes opens save dialog; Save confirms and ejects to recipes', async () => {
    renderStaples()
    await screen.findByText('Olive oil')

    fireEvent.click(screen.getByText('Soy sauce'))
    fireEvent.click(screen.getByRole('button', { name: /^Back$/i }))

    const dialog = await screen.findByRole('dialog', { name: /Save what you/i })
    fireEvent.click(within(dialog).getByRole('button', { name: /^Save$/i }))

    expect(mockApi.confirmStaples).toHaveBeenCalled()
    const call = mockApi.confirmStaples.mock.calls.find((c) => Array.isArray(c[1]) && c[1].includes('soy sauce'))
    expect(call).toBeTruthy()
    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboarding_completed_at: expect.any(String),
          }),
        })
      )
    })
    expect(screen.queryByText(/You're all set/i)).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('recipes-dest')).toBeInTheDocument()
    })
  })

  it('1.6: Back with no changes goes to bridge without save prompt', async () => {
    renderStaples()
    await screen.findByText('Olive oil')

    fireEvent.click(screen.getByRole('button', { name: /^Back$/i }))
    expect(screen.queryByRole('dialog', { name: /Save what you/i })).toBeNull()
    await screen.findByTestId('bridge-dest')
  })
})
