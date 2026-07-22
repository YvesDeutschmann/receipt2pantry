import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { format, startOfWeek } from 'date-fns'
import MealPlan from '../pages/MealPlan'

const USER_ID = 'user-1'
const HOUSEHOLD_ID = 'house-1'
const MEAL_ID = 'meal-1'

const { getHousehold, getMealPlan, updateMeal, deleteMeal } = vi.hoisted(() => ({
  getHousehold: vi.fn(),
  getMealPlan: vi.fn(),
  updateMeal: vi.fn(),
  deleteMeal: vi.fn(),
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: USER_ID },
    session: {},
    loading: false,
  }),
}))

vi.mock('../services/apiClient', () => ({
  api: {
    getHousehold,
    getRecipeDetails: vi.fn(),
    mealPlan: {
      getMealPlan,
      updateMeal,
      deleteMeal,
    },
  },
}))

vi.mock('../components/MealPlanWizard', () => ({
  default: () => null,
}))

vi.mock('../components/RecipeDetailModal', () => ({
  default: () => null,
}))

vi.mock('../components/PageHeader', () => ({
  default: () => null,
}))

function currentWeekMonday() {
  return format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
}

function mealFixture(overrides = {}) {
  return {
    id: MEAL_ID,
    recipe_name: 'Pasta Night',
    meal_date: currentWeekMonday(),
    meal_type: 'dinner',
    is_leftover: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getHousehold.mockResolvedValue({
    household: { id: HOUSEHOLD_ID, name: 'Home' },
  })
  getMealPlan.mockResolvedValue({ meals: [mealFixture()] })
  updateMeal.mockResolvedValue({ ok: true })
  deleteMeal.mockResolvedValue({ ok: true })
})

describe('MealPlan leftover toggle', () => {
  it('MEAL_PLAN_LEFTOVER_BUTTON_VISIBLE_ON_HOVER', async () => {
    render(<MealPlan />)
    expect(await screen.findByText('Pasta Night')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^leftover$/i })).toBeInTheDocument()
  })

  it('MEAL_PLAN_TOGGLE_LEFTOVER_CALLS_UPDATE_MEAL_WITH_TRUE', async () => {
    const user = userEvent.setup()
    render(<MealPlan />)
    await screen.findByText('Pasta Night')
    await user.click(screen.getByRole('button', { name: /^leftover$/i }))
    await waitFor(() => {
      expect(updateMeal).toHaveBeenCalledWith(MEAL_ID, { is_leftover: true })
    })
  })

  it('MEAL_PLAN_TOGGLE_LEFTOVER_CALLS_UPDATE_MEAL_WITH_FALSE', async () => {
    const user = userEvent.setup()
    getMealPlan.mockResolvedValue({
      meals: [mealFixture({ is_leftover: true })],
    })
    render(<MealPlan />)
    await screen.findByText('Pasta Night')
    await user.click(screen.getByRole('button', { name: /✓ leftover/i }))
    await waitFor(() => {
      expect(updateMeal).toHaveBeenCalledWith(MEAL_ID, { is_leftover: false })
    })
  })

  it('MEAL_PLAN_TOGGLE_LEFTOVER_REFRESHES_MEAL_PLAN', async () => {
    const user = userEvent.setup()
    render(<MealPlan />)
    await screen.findByText('Pasta Night')
    const callsBeforeToggle = getMealPlan.mock.calls.length
    await user.click(screen.getByRole('button', { name: /^leftover$/i }))
    await waitFor(() => {
      expect(getMealPlan.mock.calls.length).toBeGreaterThan(callsBeforeToggle)
    })
  })

  it('MEAL_PLAN_LEFTOVER_BADGE_VISIBLE', async () => {
    getMealPlan.mockResolvedValue({
      meals: [mealFixture({ is_leftover: true })],
    })
    render(<MealPlan />)
    await screen.findByText('Pasta Night')
    const badge = screen.getByText('Leftover', { selector: 'span' })
    expect(badge).toBeInTheDocument()
    expect(badge.tagName).toBe('SPAN')
  })
})
