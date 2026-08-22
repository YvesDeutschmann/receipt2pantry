import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const { getHousehold, getPantry, useAppSyncSchedulerMock, useProviderAttentionSyncMock } = vi.hoisted(() => ({
  getHousehold: vi.fn(),
  getPantry: vi.fn(),
  useAppSyncSchedulerMock: vi.fn(),
  useProviderAttentionSyncMock: vi.fn(),
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

vi.mock('../services/providerAttentionStore', () => ({
  getAttention: vi.fn(() => Promise.resolve({})),
  subscribe: vi.fn((listener) => {
    listener({});
    return () => {};
  }),
  PROVIDER_LABELS: { safeway: 'Safeway', costco: 'Costco' },
}))

vi.mock('../services/apiClient', () => ({
  api: {
    getHousehold,
    getPantry,
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
    getHousehold.mockResolvedValue({ household: null })
    getPantry.mockResolvedValue({ grouped: [] })
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
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument()
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
})
