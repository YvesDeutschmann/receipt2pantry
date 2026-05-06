import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Settings from '../pages/Settings'

function renderSettings() {
  return render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>
  )
}

const { getHousehold, triggerGeneration, healthCheck } = vi.hoisted(() => ({
  getHousehold: vi.fn(),
  triggerGeneration: vi.fn(() =>
    Promise.resolve({ status: 'completed', suggestions_generated: 5 })
  ),
  healthCheck: vi.fn(() => Promise.resolve({ status: 'ok' })),
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 't@example.com' },
    session: {},
    loading: false,
  }),
}))

vi.mock('../services/supabaseClient', () => ({
  supabase: { auth: { updateUser: vi.fn() } },
}))

vi.mock('../services/apiClient', () => ({
  api: {
    getHousehold,
    devResetOnboarding: vi.fn(),
    healthCheck,
    suggestions: {
      triggerGeneration,
    },
  },
  getApiBaseResolutionDebug: vi.fn(() => ({
    url: 'http://localhost:5000/api',
    source: 'auto',
    manualStored: null,
    syncedStored: null,
  })),
  refreshSyncedApiBaseUrl: vi.fn(() => Promise.resolve({ ok: true, changed: false })),
  setApiBaseUrlOverride: vi.fn(() => Promise.resolve()),
  shouldSyncApiBaseFromSupabase: vi.fn(() => false),
}))

describe('Settings suggestion refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getHousehold.mockResolvedValue({
      household: { id: 'hh-1', name: 'Home', role: 'owner', join_code: 'ABC' },
    })
  })

  it('REFRESH_SUGGESTIONS_BUTTON_RENDERS', async () => {
    renderSettings()
    expect(
      await screen.findByRole('button', { name: /Refresh suggestions/i })
    ).toBeInTheDocument()
  })

  it('REFRESH_SUGGESTIONS_CALLS_MANUAL_REFRESH_TRIGGER', async () => {
    renderSettings()
    await screen.findByRole('button', { name: /Refresh suggestions/i })
    fireEvent.click(screen.getByRole('button', { name: /Refresh suggestions/i }))
    await waitFor(() => {
      expect(triggerGeneration).toHaveBeenCalledWith('user-1', {
        triggerReason: 'manual_refresh',
        householdId: 'hh-1',
      })
    })
  })

  it('REFRESH_SUGGESTIONS_SHOWS_PROGRESS_THEN_SUCCESS', async () => {
    let resolveGen
    triggerGeneration.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGen = resolve
        })
    )
    renderSettings()
    await screen.findByRole('button', { name: /Refresh suggestions/i })
    fireEvent.click(screen.getByRole('button', { name: /Refresh suggestions/i }))
    expect(
      screen.getByRole('button', { name: /Refreshing…/i })
    ).toBeDisabled()
    resolveGen({ status: 'completed' })
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Suggestions updated.')
    })
    expect(
      screen.getByRole('button', { name: /Refresh suggestions/i })
    ).not.toBeDisabled()
  })
})
