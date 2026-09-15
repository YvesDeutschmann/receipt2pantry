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

const {
  getHousehold,
  getReceiptSummary,
  triggerGeneration,
  healthCheck,
  devCookLoopReset,
  devCookLoopRun,
  deleteAccount,
  mockSignOut,
  mockNavigate,
} = vi.hoisted(() => ({
  getHousehold: vi.fn(),
  getReceiptSummary: vi.fn(() =>
    Promise.resolve({
      total_receipts: 0,
      month_spend: 0,
      total_items: 0,
      recent: [],
    })
  ),
  triggerGeneration: vi.fn(() =>
    Promise.resolve({ status: 'completed', suggestions_generated: 5 })
  ),
  healthCheck: vi.fn(() => Promise.resolve({ status: 'ok' })),
  devCookLoopReset: vi.fn(() =>
    Promise.resolve({ ok: true, checks: [{ id: 'seed_class_pasta', ok: true }] })
  ),
  devCookLoopRun: vi.fn(() =>
    Promise.resolve({ ok: true, checks: [{ id: 'touched_bases', ok: true }] })
  ),
  deleteAccount: vi.fn(() => Promise.resolve({ deleted: true, household: 'deleted' })),
  mockSignOut: vi.fn(() => Promise.resolve()),
  mockNavigate: vi.fn(),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 't@example.com' },
    session: {},
    loading: false,
    signOut: mockSignOut,
  }),
}))

vi.mock('../components/AdaptiveModal', () => ({
  default: ({ isOpen, title, children, footer, onClose }) =>
    isOpen ? (
      <div data-testid="adaptive-modal">
        <h2>{title}</h2>
        {children}
        {footer}
        <button type="button" onClick={onClose}>Close modal</button>
      </div>
    ) : null,
}))

vi.mock('../services/costcoWebViewBridge', () => ({
  clearCostcoInAppBrowserSession: vi.fn(() => Promise.resolve()),
  clearStoredTokens: vi.fn(() => Promise.resolve()),
}))

vi.mock('../services/safewayWebViewBridge', () => ({
  clearStoredTokens: vi.fn(() => Promise.resolve()),
}))

vi.mock('../services/supabaseClient', () => ({
  supabase: { auth: { updateUser: vi.fn() } },
}))

vi.mock('../services/apiClient', () => ({
  api: {
    getHousehold,
    getReceiptSummary,
    deleteAccount,
    devResetOnboarding: vi.fn(),
    devCookLoopReset,
    devCookLoopRun,
    devCookLoopReport: vi.fn(),
    healthCheck,
    suggestions: {
      triggerGeneration,
    },
  },
  postDevLog: vi.fn(),
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
        mealTypes: [expect.stringMatching(/^(breakfast|lunch|dinner)$/)],
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

describe('Settings cook-loop sandbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getHousehold.mockResolvedValue({
      household: { id: 'hh-1', name: 'Home', role: 'owner', join_code: 'ABC' },
    })
    import.meta.env.DEV = true
  })

  it('COOK_LOOP_RESET_CALLS_API', async () => {
    renderSettings()
    const btn = await screen.findByRole('button', { name: /Reset cook-loop sandbox/i })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(devCookLoopReset).toHaveBeenCalled()
    })
  })

  it('COOK_LOOP_RUN_CALLS_API', async () => {
    renderSettings()
    const btn = await screen.findByRole('button', { name: /Run cook-loop QA/i })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(devCookLoopRun).toHaveBeenCalled()
    })
  })
})

describe('Settings delete account', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getHousehold.mockResolvedValue({ household: null })
    deleteAccount.mockResolvedValue({ deleted: true, household: 'deleted' })
  })

  it('DELETE_ACCOUNT_MODAL_CANCEL_DOES_NOT_CALL_API', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: /^Delete$/i }))
    expect(screen.getByTestId('adaptive-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    expect(deleteAccount).not.toHaveBeenCalled()
  })

  it('DELETE_ACCOUNT_CONFIRM_CALLS_API_AND_SIGN_OUT', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: /^Delete$/i }))
    fireEvent.click(screen.getByRole('button', { name: /Delete permanently/i }))
    await waitFor(() => {
      expect(deleteAccount).toHaveBeenCalled()
      expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' })
      expect(mockNavigate).toHaveBeenCalledWith('/auth', { replace: true })
    })
  })

  it('DELETE_ACCOUNT_API_ERROR_KEEPS_SESSION', async () => {
    deleteAccount.mockRejectedValue({
      response: { data: { error: 'Server blew up' } },
    })
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: /^Delete$/i }))
    fireEvent.click(screen.getByRole('button', { name: /Delete permanently/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Server blew up')
    })
    expect(mockSignOut).not.toHaveBeenCalled()
  })
})
