import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const {
  getHousehold,
  getPantry,
  getPool,
  getSuggestions,
  useAppSyncSchedulerMock,
  useProviderAttentionSyncMock,
  subscribeMock,
  getAttentionMock,
} = vi.hoisted(() => ({
  getHousehold: vi.fn(),
  getPantry: vi.fn(),
  getPool: vi.fn(),
  getSuggestions: vi.fn(),
  useAppSyncSchedulerMock: vi.fn(),
  useProviderAttentionSyncMock: vi.fn(),
  subscribeMock: vi.fn((listener) => {
    listener({})
    return () => {}
  }),
  getAttentionMock: vi.fn(() => Promise.resolve({})),
}))

// Mock AuthContext to provide authenticated user for tests
vi.mock('../contexts/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({
    user: {
      id: '00000000-0000-0000-0000-000000000001',
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

vi.mock('../hooks/useAppSyncScheduler', () => ({
  useAppSyncScheduler: (...args) => useAppSyncSchedulerMock(...args),
}))

vi.mock('../hooks/useProviderAttentionSync', () => ({
  useProviderAttentionSync: (...args) => useProviderAttentionSyncMock(...args),
}))

vi.mock('../hooks/useSyncHealthRecorder', () => ({
  useSyncHealthRecorder: vi.fn(),
}))

vi.mock('../services/providerAttentionStore', () => ({
  getAttention: (...args) => getAttentionMock(...args),
  subscribe: (...args) => subscribeMock(...args),
  PROVIDER_LABELS: { safeway: 'Safeway', costco: 'Costco' },
}))

vi.mock('../services/apiClient', () => ({
  api: {
    getHousehold,
    getPantry,
    suggestions: {
      getPool: getPool,
      getSuggestions,
      triggerGeneration: vi.fn(),
    },
    dismissSuggestion: vi.fn(),
    markCooked: vi.fn(),
    correctPantryItem: vi.fn(),
    devCookLoopReport: vi.fn(),
  },
  postDevLog: vi.fn(),
}))

vi.mock('../services/supabaseClient', () => ({
  supabase: { auth: { updateUser: vi.fn() } },
}))

import App from '../App'

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.pushState({}, '', '/')
    subscribeMock.mockImplementation((listener) => {
      listener({})
      return () => {}
    })
    getAttentionMock.mockResolvedValue({})
    getHousehold.mockResolvedValue({ household: null })
    getPantry.mockResolvedValue({ grouped: [] })
    getPool.mockResolvedValue({ breakfast: [], lunch: [], dinner: [] })
    getSuggestions.mockResolvedValue({
      use_soon_shelf: [],
      cook_tonight: [],
      probably_have: [],
      check_first: [],
    })
  })

  afterEach(() => {
    window.history.pushState({}, '', '/')
  })

  it('renders without crashing', () => {
    render(<App />)
    // Check for header navigation (or dashboard content)
    const navigation = screen.getByRole('navigation')
    expect(navigation).toBeInTheDocument()
  })

  it('renders navigation links', () => {
    render(<App />)
    // Use getByRole to specifically target navigation links
    expect(screen.getByRole('link', { name: /what's for dinner/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /dashboard/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /providers/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument()
  })

  it('SCHEDULER_MOUNTED_AT_ROOT — useAppSyncScheduler invoked with user id', () => {
    render(<App />)
    expect(useAppSyncSchedulerMock).toHaveBeenCalledWith({
      userId: '00000000-0000-0000-0000-000000000001',
    })
  })

  it('ATTENTION_LISTENER_MOUNTED_AT_APPROUTES — useProviderAttentionSync invoked', () => {
    render(<App />)
    expect(useProviderAttentionSyncMock).toHaveBeenCalled()
  })

  it('INDEX_AND_AUTH_REDIRECT_TO_RECIPES', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { name: /recipe ideas/i })).toBeInTheDocument()
  })

  it('DASHBOARD_ROUTE_GONE', async () => {
    window.history.pushState({}, '', '/dashboard')
    render(<App />)
    expect(await screen.findByRole('heading', { name: /recipe ideas/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /dashboard/i })).not.toBeInTheDocument()
  })

  it('RECIPES_SHOWS_SLIM_ATTENTION_WHEN_STORE_SET', async () => {
    subscribeMock.mockImplementation((listener) => {
      listener({ safeway: { kind: 'fetch_failed', updatedAt: 1 } })
      return () => {}
    })
    render(<App />)
    expect(await screen.findByRole('heading', { name: /needs attention/i })).toBeInTheDocument()
    expect(screen.getByText(/Safeway couldn't sync/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Try again/i })).toHaveAttribute('href', '/providers')
    const section = screen.getByRole('region', { name: /needs attention/i })
    expect(section.className).toMatch(/p-3/)
    expect(section.className).not.toMatch(/p-5/)
  })
})
