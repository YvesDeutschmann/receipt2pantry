import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HouseholdFork from '../pages/onboarding/HouseholdFork'

const mockNavigate = vi.fn()
const mockCreateHouseholdExplicit = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('../contexts/OnboardingContext', () => ({
  useOnboarding: () => ({
    householdId: null,
    householdRole: null,
    householdResolved: true,
    householdLoading: false,
    householdError: null,
    createHouseholdExplicit: mockCreateHouseholdExplicit,
  }),
}))

function renderFork() {
  return render(
    <MemoryRouter>
      <HouseholdFork />
    </MemoryRouter>
  )
}

describe('HouseholdFork', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateHouseholdExplicit.mockResolvedValue({ id: 'new-hh' })
  })

  it('shows create vs join choices when no household', () => {
    renderFork()
    expect(screen.getByText('I have a join code')).toBeInTheDocument()
    expect(screen.getByText('Create my household')).toBeInTheDocument()
  })

  it('navigates to join screen when user has a code', () => {
    renderFork()
    fireEvent.click(screen.getByText('I have a join code'))
    expect(mockNavigate).toHaveBeenCalledWith('/onboarding/join')
    expect(mockCreateHouseholdExplicit).not.toHaveBeenCalled()
  })

  it('creates household explicitly when user chooses create', async () => {
    renderFork()
    fireEvent.click(screen.getByText('Create my household'))
    await waitFor(() => {
      expect(mockCreateHouseholdExplicit).toHaveBeenCalledTimes(1)
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding/size')
    })
  })
})
