import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import JoinHousehold from '../pages/onboarding/JoinHousehold'

const mockNavigate = vi.fn()
const mockJoinHouseholdByCode = vi.fn()
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
    householdResolved: true,
    householdLoading: false,
    joinHouseholdByCode: mockJoinHouseholdByCode,
    createHouseholdExplicit: mockCreateHouseholdExplicit,
  }),
}))

function renderJoin() {
  return render(
    <MemoryRouter>
      <JoinHousehold />
    </MemoryRouter>
  )
}

describe('JoinHousehold', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockJoinHouseholdByCode.mockResolvedValue({ id: 'joined-hh', role: 'member' })
    mockCreateHouseholdExplicit.mockResolvedValue({ id: 'new-hh' })
  })

  it('shows error on bad code without creating a household', async () => {
    mockJoinHouseholdByCode.mockRejectedValue({
      response: { data: { error: 'Invalid join code. Please check and try again.' } },
    })

    renderJoin()
    fireEvent.change(screen.getByPlaceholderText('ABC123'), {
      target: { value: 'BADBAD' },
    })
    fireEvent.click(screen.getByText('Join household'))

    await waitFor(() => {
      expect(screen.getByText(/Invalid join code/i)).toBeInTheDocument()
    })
    expect(mockCreateHouseholdExplicit).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalledWith('/onboarding/size')
  })

  it('navigates to dietary on successful join', async () => {
    renderJoin()
    fireEvent.change(screen.getByPlaceholderText('ABC123'), {
      target: { value: 'ABC123' },
    })
    fireEvent.click(screen.getByText('Join household'))

    await waitFor(() => {
      expect(mockJoinHouseholdByCode).toHaveBeenCalledWith('ABC123')
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding/dietary')
    })
  })

  it('create my own household instead creates and routes to size', async () => {
    renderJoin()
    fireEvent.click(screen.getByText('Create my own household instead'))

    await waitFor(() => {
      expect(mockCreateHouseholdExplicit).toHaveBeenCalledTimes(1)
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding/size')
    })
  })
})
