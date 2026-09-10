import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom'

const mockFeatures = vi.hoisted(() => ({ mealPlanner: false, emailAuth: false }))
const mockAuthUser = vi.hoisted(() => ({
  current: {
    id: 'user-1',
    email: 'test@example.com',
    user_metadata: {},
  },
}))

vi.mock('../config/features', () => ({
  FEATURES: mockFeatures,
}))

const { getHousehold, getPantry, getReceiptSummary } = vi.hoisted(() => ({
  getHousehold: vi.fn(),
  getPantry: vi.fn(),
  getReceiptSummary: vi.fn(),
}))

vi.mock('../services/apiClient', () => ({
  api: { getHousehold, getPantry, getReceiptSummary },
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockAuthUser.current,
    signOut: vi.fn(),
    signIn: vi.fn(),
    signUp: vi.fn(),
    signInWithApple: vi.fn(),
    signInWithGoogle: vi.fn(),
  }),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'web',
  },
}))

vi.mock('../services/providerAttentionStore', () => ({
  getAttention: vi.fn(() => Promise.resolve({})),
  subscribe: vi.fn((listener) => {
    listener({})
    return () => {}
  }),
  PROVIDER_LABELS: { safeway: 'Safeway', costco: 'Costco' },
}))

import BottomTabBar from '../components/BottomTabBar'
import TopNavBar from '../components/TopNavBar'
import Auth from '../pages/Auth'

function MealPlanRouteProbe() {
  return <h1>Meal Plan</h1>
}

function TestAppRoutes({ mealPlanner }) {
  return (
    <Routes>
      <Route index element={<Navigate to="/recipes" replace />} />
      <Route path="recipes" element={<h1>Cook</h1>} />
      {mealPlanner && <Route path="meal-plan" element={<MealPlanRouteProbe />} />}
      <Route path="*" element={<Navigate to="/recipes" replace />} />
    </Routes>
  )
}

describe('meal planner feature flag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFeatures.mealPlanner = false
    mockFeatures.emailAuth = false
    mockAuthUser.current = {
      id: 'user-1',
      email: 'test@example.com',
      user_metadata: {},
    }
    getHousehold.mockResolvedValue({ household: null })
    getPantry.mockResolvedValue({ grouped: [] })
    getReceiptSummary.mockResolvedValue({
      total_receipts: 0,
      month_spend: 0,
      total_items: 0,
      recent: [],
    })
  })

  it('BOTTOM_TAB_HIDES_MEAL_PLAN_WHEN_FLAG_OFF', () => {
    render(
      <MemoryRouter>
        <BottomTabBar />
      </MemoryRouter>
    )
    expect(screen.queryByRole('link', { name: /meal plan/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /what's for (breakfast|lunch|dinner)/i })).toBeInTheDocument()
    expect(screen.getByText('Cook')).toBeInTheDocument()
  })

  it('TOP_NAV_HIDES_MEAL_PLAN_WHEN_FLAG_OFF', () => {
    render(
      <MemoryRouter>
        <TopNavBar />
      </MemoryRouter>
    )
    expect(screen.queryByRole('link', { name: /meal plan/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /what's for (breakfast|lunch|dinner)/i })).toBeInTheDocument()
  })

  it('MEAL_PLAN_ROUTE_REDIRECTS_TO_RECIPES_WHEN_FLAG_OFF', () => {
    render(
      <MemoryRouter initialEntries={['/meal-plan']}>
        <TestAppRoutes mealPlanner={false} />
      </MemoryRouter>
    )
    expect(screen.getByRole('heading', { name: /^cook$/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^meal plan$/i })).not.toBeInTheDocument()
  })

  it('TAB_BAR_HAS_NO_DASHBOARD_DINNER_IS_FIRST', () => {
    render(
      <MemoryRouter>
        <BottomTabBar />
      </MemoryRouter>
    )
    expect(screen.queryByRole('link', { name: /dashboard/i })).not.toBeInTheDocument()
    const links = screen.getAllByRole('link')
    expect(links[0]).toHaveAttribute('href', '/recipes')
  })

  it('BOTTOM_TAB_SHOWS_MEAL_PLAN_WHEN_FLAG_ON', () => {
    mockFeatures.mealPlanner = true
    render(
      <MemoryRouter>
        <BottomTabBar />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: /meal plan/i })).toBeInTheDocument()
  })

  it('TOP_NAV_SHOWS_MEAL_PLAN_WHEN_FLAG_ON', () => {
    mockFeatures.mealPlanner = true
    render(
      <MemoryRouter>
        <TopNavBar />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: /meal plan/i })).toBeInTheDocument()
  })

  it('MEAL_PLAN_ROUTE_RENDERS_WHEN_FLAG_ON', () => {
    render(
      <MemoryRouter initialEntries={['/meal-plan']}>
        <TestAppRoutes mealPlanner />
      </MemoryRouter>
    )
    expect(screen.getByRole('heading', { name: /^meal plan$/i })).toBeInTheDocument()
  })
})

describe('email auth feature flag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFeatures.emailAuth = false
    mockAuthUser.current = null
  })

  it('AUTH_HIDES_EMAIL_PATH_WHEN_FLAG_OFF', () => {
    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    )
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /use email instead/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create account/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /dev: sign in as test user/i })).not.toBeInTheDocument()
  })

  it('AUTH_SHOWS_EMAIL_ENTRY_WHEN_FLAG_ON', () => {
    mockFeatures.emailAuth = true
    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    )
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /use email instead/i })).toBeInTheDocument()
  })
})

describe('Track 1 home routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFeatures.mealPlanner = false
    mockFeatures.emailAuth = false
  })

  it('INDEX_AND_AUTH_REDIRECT_TO_RECIPES', () => {
    mockAuthUser.current = {
      id: 'user-1',
      email: 'test@example.com',
      user_metadata: { onboarding_completed_at: '2026-01-01' },
    }
    render(
      <MemoryRouter initialEntries={['/auth']}>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/recipes" element={<h1>Cook</h1>} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByRole('heading', { name: /^cook$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign in with google/i })).not.toBeInTheDocument()
  })
})
