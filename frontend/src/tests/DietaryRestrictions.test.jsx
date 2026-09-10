import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DietaryRestrictions from '../pages/onboarding/DietaryRestrictions'

const onboardingMock = vi.hoisted(() => {
  const state = {
    rawDietaryRestrictions: [],
    noRestrictions: false,
    otherRestriction: '',
    householdId: 'household-join',
    householdResolved: true,
    householdLoading: false,
    isJoiner: true,
  }
  return {
    state,
    toggleRestriction: vi.fn((code) => {
      if (!state.rawDietaryRestrictions.includes(code)) {
        state.rawDietaryRestrictions = [...state.rawDietaryRestrictions, code]
      }
    }),
    setRestrictionsAffirmativeNone: vi.fn(() => {
      state.noRestrictions = true
      state.rawDietaryRestrictions = []
    }),
    setOtherRestriction: vi.fn((text) => {
      state.otherRestriction = text
    }),
    mergeJoinDietary: vi.fn().mockResolvedValue(undefined),
    completeJoin: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('../contexts/OnboardingContext', () => ({
  useOnboarding: () => ({
    rawDietaryRestrictions: onboardingMock.state.rawDietaryRestrictions,
    noRestrictions: onboardingMock.state.noRestrictions,
    toggleRestriction: onboardingMock.toggleRestriction,
    setRestrictionsAffirmativeNone: onboardingMock.setRestrictionsAffirmativeNone,
    otherRestriction: onboardingMock.state.otherRestriction,
    setOtherRestriction: onboardingMock.setOtherRestriction,
    householdId: onboardingMock.state.householdId,
    householdResolved: onboardingMock.state.householdResolved,
    householdLoading: onboardingMock.state.householdLoading,
    isJoiner: onboardingMock.state.isJoiner,
    mergeJoinDietary: onboardingMock.mergeJoinDietary,
    completeJoin: onboardingMock.completeJoin,
  }),
}))

vi.mock('../components/ColdStartProgressBar', () => ({
  default: () => <div data-testid="cold-start-progress" />,
}))

function renderDietary() {
  return render(
    <MemoryRouter>
      <DietaryRestrictions />
    </MemoryRouter>
  )
}

describe('DietaryRestrictions joiner payoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    onboardingMock.state.rawDietaryRestrictions = []
    onboardingMock.state.noRestrictions = false
    onboardingMock.state.otherRestriction = ''
    onboardingMock.state.isJoiner = true
    onboardingMock.mergeJoinDietary.mockResolvedValue(undefined)
    onboardingMock.completeJoin.mockResolvedValue(undefined)
  })

  it('JOINER_FINISH_SHOWS_PAYOFF_THEN_COMPLETE_JOIN_ON_TAP', async () => {
    renderDietary()

    fireEvent.click(screen.getByRole('button', { name: /No dietary restrictions/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Finish$/i }))

    await waitFor(() => {
      expect(onboardingMock.mergeJoinDietary).toHaveBeenCalledTimes(1)
    })
    expect(onboardingMock.completeJoin).not.toHaveBeenCalled()

    expect(await screen.findByText(/You're in — see what you can cook tonight/i)).toBeInTheDocument()
    expect(screen.queryByText(/pantry baseline/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /What's for Dinner/i }))

    await waitFor(() => {
      expect(onboardingMock.completeJoin).toHaveBeenCalledTimes(1)
    })
  })
})
