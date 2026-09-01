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

const { getHousehold, getPantry } = vi.hoisted(() => ({
  getHousehold: vi.fn(),
  getPantry: vi.fn(),
}))

vi.mock('../services/apiClient', () => ({
  api: { getHousehold, getPantry },
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
import Dashboard from '../pages/Dashboard'
import Auth from '../pages/Auth'

function MealPlanRouteProbe() {
  return <h1>Meal Plan</h1>
}

function TestAppRoutes({ mealPlanner }) {
  return (
    <Routes>
      <Route index element={<Dashboard />} />
      {mealPlanner && <Route path="meal-plan" element={<MealPlanRouteProbe />} />}
      <Route path="*" element={<Navigate to="/" replace />} />
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
  })

  it('BOTTOM_TAB_HIDES_MEAL_PLAN_WHEN_FLAG_OFF', () => {
    render(
      <MemoryRouter>
        <BottomTabBar />
      </MemoryRouter>
    )
    expect(screen.queryByRole('link', { name: /meal plan/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /what's for dinner/i })).toBeInTheDocument()
  })

  it('TOP_NAV_HIDES_MEAL_PLAN_WHEN_FLAG_OFF', () => {
    render(
      <MemoryRouter>
        <TopNavBar />
      </MemoryRouter>
    )
    expect(screen.queryByRole('link', { name: /meal plan/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /what's for dinner/i })).toBeInTheDocument()
  })

  it('MEAL_PLAN_ROUTE_REDIRECTS_TO_DASHBOARD_WHEN_FLAG_OFF', () => {
    render(
      <MemoryRouter initialEntries={['/meal-plan']}>
        <TestAppRoutes mealPlanner={false} />
      </MemoryRouter>
    )
    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^meal plan$/i })).not.toBeInTheDocument()
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
