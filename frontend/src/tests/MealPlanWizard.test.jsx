import { describe, it, expect, vi, beforeEach } from 'vitest'
import React, { StrictMode } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MealPlanWizard from '../components/MealPlanWizard'

const {
  startWizard,
  getSuggestions,
  acceptRecipe,
  softRejectRecipe,
  banRecipe,
  unbanRecipe,
  completeWizard,
} = vi.hoisted(() => ({
  startWizard: vi.fn(),
  getSuggestions: vi.fn(),
  acceptRecipe: vi.fn(),
  softRejectRecipe: vi.fn(),
  banRecipe: vi.fn(),
  unbanRecipe: vi.fn(),
  completeWizard: vi.fn(),
}))

vi.mock('../services/apiClient', () => ({
  api: {
    mealPlan: {
      startWizard,
      getSuggestions,
      acceptRecipe,
      softRejectRecipe,
      banRecipe,
      unbanRecipe,
      completeWizard,
    },
  },
}))

vi.mock('../components/PantryCheckSheet', () => ({
  default: () => null,
}))

const USER_ID = 'user-1'
const HOUSEHOLD_ID = 'house-1'

const defaultStartResponse = {
  session_id: 'sess-1',
  household_member_count: 2,
}

const dinnerEntry = (name = 'Pasta Night') => ({
  recipe_name: name,
  meal_date: '2026-04-27',
  meal_type: 'dinner',
})

function recipe(id, title, overrides = {}) {
  return {
    id,
    title,
    usedIngredientCount: 3,
    missedIngredientCount: 0,
    missedIngredients: [],
    ...overrides,
  }
}

async function startPlanningSession(user = userEvent.setup()) {
  await user.click(screen.getByRole('button', { name: /start planning/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  startWizard.mockResolvedValue(defaultStartResponse)
  getSuggestions.mockResolvedValue({ recipes: [] })
  acceptRecipe.mockResolvedValue({ meal_plan_entry: dinnerEntry() })
  softRejectRecipe.mockResolvedValue({})
  banRecipe.mockResolvedValue({})
  unbanRecipe.mockResolvedValue({})
  completeWizard.mockResolvedValue({ ok: true })
})

describe('MealPlanWizard', () => {
  /** A — mount / session */
  it('test_startWizard_called_exactly_once_on_mount', async () => {
    const user = userEvent.setup()
    render(
      <StrictMode>
        <MealPlanWizard
          isOpen
          onClose={vi.fn()}
          onComplete={vi.fn()}
          userId={USER_ID}
          householdId={HOUSEHOLD_ID}
        />
      </StrictMode>
    )
    await startPlanningSession(user)
    expect(startWizard).toHaveBeenCalledTimes(1)
    expect(startWizard).toHaveBeenCalledWith(USER_ID, {
      meal_slots: { breakfast: false, lunch: false, dinner: true },
      start_date: expect.any(String),
      household_id: HOUSEHOLD_ID,
    })
  })

  it('test_startWizard_not_called_when_mealSlots_all_false', async () => {
    const user = userEvent.setup()
    render(
      <MealPlanWizard
        isOpen
        onClose={vi.fn()}
        onComplete={vi.fn()}
        userId={USER_ID}
        householdId={HOUSEHOLD_ID}
      />
    )
    await user.click(screen.getByRole('checkbox', { name: /^dinner$/i }))
    const startBtn = screen.getByRole('button', { name: /start planning/i })
    expect(startBtn).toBeDisabled()
    fireEvent.click(startBtn)
    expect(startWizard).not.toHaveBeenCalled()
  })

  /** B — suggestion loop */
  it('test_getSuggestions_called_with_initial_threshold_0_9', async () => {
    const user = userEvent.setup()
    getSuggestions.mockResolvedValue({
      recipes: [recipe('r1', 'Soup')],
    })
    render(
      <MealPlanWizard
        isOpen
        onClose={vi.fn()}
        onComplete={vi.fn()}
        userId={USER_ID}
        householdId={HOUSEHOLD_ID}
      />
    )
    await startPlanningSession(user)
    await waitFor(() => {
      expect(getSuggestions).toHaveBeenCalled()
    })
    expect(getSuggestions).toHaveBeenCalledWith('sess-1', 'dinner', 0.9)
  })

  it('test_getSuggestions_threshold_lowers_when_empty_result', async () => {
    const user = userEvent.setup()
    getSuggestions.mockResolvedValueOnce({ recipes: [] }).mockResolvedValue({
      recipes: [recipe('r-low', 'Low Match Meal')],
    })
    render(
      <MealPlanWizard
        isOpen
        onClose={vi.fn()}
        onComplete={vi.fn()}
        userId={USER_ID}
        householdId={HOUSEHOLD_ID}
      />
    )
    await startPlanningSession(user)
    await waitFor(() => expect(screen.getByText(/no recipes found/i)).toBeInTheDocument())
    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '0.7' } })
    fireEvent.mouseUp(slider)
    await waitFor(() => {
      expect(getSuggestions.mock.calls.some((c) => c[2] === 0.7)).toBe(true)
    })
  })

  /** C — accept / reject / ban */
  it('test_accept_calls_acceptRecipe_and_advances_to_next_meal_slot', async () => {
    const user = userEvent.setup()
    getSuggestions.mockResolvedValue({
      recipes: [recipe('r1', 'First Dinner')],
    })
    render(
      <MealPlanWizard
        isOpen
        onClose={vi.fn()}
        onComplete={vi.fn()}
        userId={USER_ID}
        householdId={HOUSEHOLD_ID}
      />
    )
    await startPlanningSession(user)
    await screen.findByRole('heading', { name: 'First Dinner' })
    await user.click(screen.getByRole('button', { name: /accept recipe/i }))
    await waitFor(() => {
      expect(acceptRecipe).toHaveBeenCalledWith('sess-1', {
        recipe_id: 'r1',
        meal_date: expect.any(String),
        meal_type: 'dinner',
      })
    })
    await waitFor(() => {
      expect(screen.getByText(/meal 2 of 7/i)).toBeInTheDocument()
    })
  })

  it('test_soft_reject_removes_recipe_from_local_candidates_only', async () => {
    const user = userEvent.setup()
    getSuggestions.mockResolvedValue({
      recipes: [recipe('gone', 'Skip Me'), recipe('stay', 'Keep Me')],
    })
    render(
      <MealPlanWizard
        isOpen
        onClose={vi.fn()}
        onComplete={vi.fn()}
        userId={USER_ID}
        householdId={HOUSEHOLD_ID}
      />
    )
    await startPlanningSession(user)
    await screen.findByRole('heading', { name: 'Skip Me' })
    const notTonightButtons = screen.getAllByRole('button', { name: /not tonight/i })
    await user.click(notTonightButtons[0])
    expect(banRecipe).not.toHaveBeenCalled()
    expect(softRejectRecipe).toHaveBeenCalledWith('sess-1', 'gone')
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Skip Me' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { name: 'Keep Me' })).toBeInTheDocument()
  })

  it('test_ban_calls_banRecipe_and_removes_from_candidates', async () => {
    const user = userEvent.setup()
    const twoRecipes = [
      recipe('bad', 'Ban This One'),
      recipe('other', 'Other Meal'),
    ]
    getSuggestions
      .mockResolvedValueOnce({ recipes: twoRecipes })
      .mockResolvedValueOnce({ recipes: twoRecipes })
      .mockResolvedValue({ recipes: [] })
    render(
      <MealPlanWizard
        isOpen
        onClose={vi.fn()}
        onComplete={vi.fn()}
        userId={USER_ID}
        householdId={HOUSEHOLD_ID}
      />
    )
    await startPlanningSession(user)
    await screen.findByRole('heading', { name: 'Ban This One' })
    const banButtons = screen.getAllByRole('button', { name: /absolutely not/i })
    await user.click(banButtons[0])
    await waitFor(() => {
      expect(banRecipe).toHaveBeenCalledWith('sess-1', 'bad', 'Ban This One', USER_ID)
    })
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Ban This One' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { name: 'Other Meal' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/recipe banned for 6 months/i)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /^undo$/i }))
    await waitFor(() => {
      expect(unbanRecipe).toHaveBeenCalledWith('sess-1', 'bad', USER_ID)
    })
  })

  it('test_accept_twice_on_same_recipe_is_noop', async () => {
    const user = userEvent.setup()
    // Hold the first acceptRecipe call open so the in-flight guard
    // (acceptingRecipeId) is still active for the second click.
    let releaseAccept
    acceptRecipe.mockImplementationOnce(
      () => new Promise((resolve) => {
        releaseAccept = () => resolve({ meal_plan_entry: dinnerEntry() })
      })
    )
    getSuggestions.mockResolvedValue({
      recipes: [recipe('r1', 'Solo Meal')],
    })
    render(
      <MealPlanWizard
        isOpen
        onClose={vi.fn()}
        onComplete={vi.fn()}
        userId={USER_ID}
        householdId={HOUSEHOLD_ID}
      />
    )
    await startPlanningSession(user)
    await waitFor(() => {
      const btns = screen.queryAllByRole('button', { name: /accept recipe/i })
      expect(btns.length).toBeGreaterThan(0)
    })
    const acceptBtn = screen.getAllByRole('button', { name: /accept recipe/i })[0]
    fireEvent.click(acceptBtn)
    fireEvent.click(acceptBtn)
    await waitFor(() => expect(acceptRecipe).toHaveBeenCalledTimes(1))
    releaseAccept?.()
  })

  /** D — complete / close */
  it('test_complete_calls_completeWizard_and_invokes_onComplete_prop', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    const onClose = vi.fn()
    getSuggestions.mockResolvedValue({ recipes: [] })
    render(
      <MealPlanWizard
        isOpen
        onClose={onClose}
        onComplete={onComplete}
        userId={USER_ID}
        householdId={HOUSEHOLD_ID}
      />
    )
    await startPlanningSession(user)
    await screen.findByText(/no recipes found/i)
    await user.click(screen.getByRole('button', { name: /complete with current selections/i }))
    await waitFor(() => {
      expect(completeWizard).toHaveBeenCalledWith('sess-1')
      expect(onComplete).toHaveBeenCalledWith({ ok: true })
    })
  })

  it('test_closing_without_complete_does_not_call_completeWizard', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <MealPlanWizard
        isOpen
        onClose={onClose}
        onComplete={vi.fn()}
        userId={USER_ID}
        householdId={HOUSEHOLD_ID}
      />
    )
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(onClose).toHaveBeenCalled()
    expect(completeWizard).not.toHaveBeenCalled()
  })

  /** E — error UX */
  it('test_500_from_getSuggestions_surfaces_retry_ui', async () => {
    const user = userEvent.setup()
    getSuggestions.mockRejectedValueOnce({
      response: { status: 500, data: { error: 'Internal server error' } },
    })
    render(
      <MealPlanWizard
        isOpen
        onClose={vi.fn()}
        onComplete={vi.fn()}
        userId={USER_ID}
        householdId={HOUSEHOLD_ID}
      />
    )
    await startPlanningSession(user)
    await waitFor(() => {
      expect(screen.getByText(/internal server error|failed to load suggestions/i)).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.queryByText(/loading suggestions/i)).not.toBeInTheDocument()
    })
  })

  it('test_acceptRecipe_failure_does_not_advance_step', async () => {
    const user = userEvent.setup()
    acceptRecipe.mockRejectedValueOnce({
      response: { status: 400, data: { error: 'Cannot accept' } },
    })
    getSuggestions.mockResolvedValue({
      recipes: [recipe('r1', 'Fail Accept')],
    })
    render(
      <MealPlanWizard
        isOpen
        onClose={vi.fn()}
        onComplete={vi.fn()}
        userId={USER_ID}
        householdId={HOUSEHOLD_ID}
      />
    )
    await startPlanningSession(user)
    await screen.findByRole('heading', { name: 'Fail Accept' })
    await user.click(screen.getByRole('button', { name: /accept recipe/i }))
    await waitFor(() => expect(screen.getByText(/cannot accept/i)).toBeInTheDocument())
    expect(screen.getByText(/meal 1 of 7/i)).toBeInTheDocument()
  })
})
