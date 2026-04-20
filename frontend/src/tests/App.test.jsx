import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const { getHousehold, getPantry } = vi.hoisted(() => ({
  getHousehold: vi.fn(),
  getPantry: vi.fn(),
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

vi.mock('../services/apiClient', () => ({
  api: {
    getHousehold,
    getPantry,
  },
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
})
