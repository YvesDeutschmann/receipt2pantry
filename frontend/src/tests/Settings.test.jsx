import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PRIVACY_URL, TERMS_URL } from '../config/legal'
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
  updateHouseholdProfile,
  mergeDietaryRestrictions,
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
  updateHouseholdProfile: vi.fn(() =>
    Promise.resolve({
      household: {
        id: 'hh-1',
        name: 'Home',
        role: 'owner',
        size: 3,
        dietary_restrictions: ['peanuts'],
      },
    })
  ),
  mergeDietaryRestrictions: vi.fn(() =>
    Promise.resolve({
      household: {
        id: 'hh-1',
        name: 'Home',
        role: 'member',
        dietary_restrictions: ['peanuts', 'shellfish'],
      },
    })
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

vi.mock('../components/HouseholdModal', () => ({
  default: ({ isOpen, onHouseholdChange }) =>
    isOpen ? (
      <button type="button" onClick={() => onHouseholdChange?.(null)}>
        Mock leave household
      </button>
    ) : null,
}))

vi.mock('../components/AdaptiveModal', () => ({
  default: ({ isOpen, title, children, footer, onClose }) =>
    isOpen ? (
      <div role="dialog" aria-label={title} data-testid="adaptive-modal">
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

vi.mock('../utils/openLegalPage', () => ({
  openLegalPage: vi.fn(() => Promise.resolve()),
}))

import { openLegalPage } from '../utils/openLegalPage'

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
    updateHouseholdProfile,
    mergeDietaryRestrictions,
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

describe('Settings grouped IA', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    import.meta.env.DEV = false
    import.meta.env.VITE_ENABLE_DEV_SETTINGS = '0'
    getHousehold.mockResolvedValue({
      household: {
        id: 'hh-1',
        name: 'Home',
        role: 'owner',
        join_code: 'ABC',
        size: 2,
        dietary_restrictions: ['peanuts'],
      },
    })
  })

  it('SHOWS_EMAIL_AND_DELETE_ROW', async () => {
    renderSettings()
    expect(await screen.findByText('t@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete account/i })).toBeInTheDocument()
    expect(screen.queryByText('Not available yet')).not.toBeInTheDocument()
  })

  it('HIDES_STUB_PREFERENCES_AND_MAIN_REFRESH', async () => {
    renderSettings()
    await screen.findByText('Connected stores')
    expect(screen.queryByText(/email notifications/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/auto-sync receipts/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /refresh suggestions/i })).not.toBeInTheDocument()
  })

  it('SIGN_OUT_CALLS_AUTH', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: /sign out/i }))
    expect(mockSignOut).toHaveBeenCalled()
  })

  it('HOUSEHOLD_ROWS_RENDER', async () => {
    renderSettings()
    expect(await screen.findByRole('button', { name: /manage household/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /people/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /diet & allergies/i })).toBeInTheDocument()
  })

  it('LEGAL_ROWS_RENDER', async () => {
    renderSettings()
    expect(await screen.findByRole('heading', { name: /^legal$/i })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /privacy policy/i })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /terms of service/i })).toHaveLength(1)
  })

  it('LEGAL_ROWS_OPEN_HOSTED_PAGES', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: /privacy policy/i }))
    expect(openLegalPage).toHaveBeenCalledTimes(1)
    expect(openLegalPage).toHaveBeenCalledWith(PRIVACY_URL)

    fireEvent.click(screen.getByRole('button', { name: /terms of service/i }))
    expect(openLegalPage).toHaveBeenCalledTimes(2)
    expect(openLegalPage).toHaveBeenLastCalledWith(TERMS_URL)
  })
})

describe('Settings suggestion refresh in Dev Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    import.meta.env.DEV = true
    getHousehold.mockResolvedValue({
      household: { id: 'hh-1', name: 'Home', role: 'owner', join_code: 'ABC', size: 2 },
    })
  })

  it('REFRESH_SUGGESTIONS_IN_DEV_TOOLS_DETAILS', async () => {
    renderSettings()
    fireEvent.click(await screen.findByText('Dev Tools'))
    const btn = await screen.findByRole('button', { name: /Refresh suggestions/i })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(triggerGeneration).toHaveBeenCalledWith('user-1', {
        triggerReason: 'manual_refresh',
        householdId: 'hh-1',
        mealTypes: [expect.stringMatching(/^(breakfast|lunch|dinner)$/)],
      })
    })
  })
})

describe('Settings household profile edit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    import.meta.env.DEV = false
    window.confirm = vi.fn(() => true)
  })

  it('SIZE_SAVE_PUTS_SIZE_ONLY', async () => {
    getHousehold.mockResolvedValue({
      household: {
        id: 'hh-1',
        name: 'Home',
        role: 'owner',
        size: 2,
        dietary_restrictions: [],
      },
    })
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: /people/i }))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => {
      expect(updateHouseholdProfile).toHaveBeenCalledWith('user-1', { size: 2 })
    })
  })

  it('OWNER_DIET_SAVE_PUTS_FULL_ARRAY', async () => {
    getHousehold.mockResolvedValue({
      household: {
        id: 'hh-1',
        name: 'Home',
        role: 'owner',
        size: 2,
        dietary_restrictions: ['peanuts'],
      },
    })
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: /diet & allergies/i }))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => {
      expect(updateHouseholdProfile).toHaveBeenCalledWith('user-1', {
        dietaryRestrictions: ['peanuts'],
      })
    })
  })

  it('MEMBER_DIET_SAVE_MERGES_ADDITIONS_ONLY', async () => {
    getHousehold.mockResolvedValue({
      household: {
        id: 'hh-1',
        name: 'Home',
        role: 'member',
        size: 2,
        dietary_restrictions: ['peanuts'],
      },
    })
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: /diet & allergies/i }))
    fireEvent.click(screen.getByText('Shellfish'))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => {
      expect(mergeDietaryRestrictions).toHaveBeenCalledWith('user-1', ['shellfish'])
    })
    expect(updateHouseholdProfile).not.toHaveBeenCalled()
  })

  it('LEAVE_HOUSEHOLD_CLOSES_PROFILE_MODALS', async () => {
    getHousehold.mockResolvedValue({
      household: {
        id: 'hh-1',
        name: 'Home',
        role: 'owner',
        size: 2,
        dietary_restrictions: [],
      },
    })
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: /people/i }))
    expect(screen.getByRole('dialog', { name: /people/i })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /manage household/i }))
    fireEvent.click(screen.getByRole('button', { name: /mock leave household/i }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /people/i })).not.toBeInTheDocument()
    })
  })
})

describe('Settings cook-loop sandbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    import.meta.env.DEV = true
    getHousehold.mockResolvedValue({
      household: { id: 'hh-1', name: 'Home', role: 'owner', join_code: 'ABC' },
    })
  })

  it('COOK_LOOP_RESET_CALLS_API', async () => {
    renderSettings()
    fireEvent.click(await screen.findByText('Dev Tools'))
    const btn = await screen.findByRole('button', { name: /Reset cook-loop sandbox/i })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(devCookLoopReset).toHaveBeenCalled()
    })
  })

  it('COOK_LOOP_RUN_CALLS_API', async () => {
    renderSettings()
    fireEvent.click(await screen.findByText('Dev Tools'))
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
    import.meta.env.DEV = false
    getHousehold.mockResolvedValue({ household: null })
    deleteAccount.mockResolvedValue({ deleted: true, household: 'deleted' })
  })

  it('DELETE_ACCOUNT_MODAL_CANCEL_DOES_NOT_CALL_API', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: /delete account/i }))
    expect(screen.getByTestId('adaptive-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    expect(deleteAccount).not.toHaveBeenCalled()
  })

  it('DELETE_ACCOUNT_CONFIRM_CALLS_API_AND_SIGN_OUT', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: /delete account/i }))
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
    fireEvent.click(await screen.findByRole('button', { name: /delete account/i }))
    fireEvent.click(screen.getByRole('button', { name: /Delete permanently/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Server blew up')
    })
    expect(mockSignOut).not.toHaveBeenCalled()
  })
})
