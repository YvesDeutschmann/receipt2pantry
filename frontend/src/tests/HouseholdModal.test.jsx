import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import HouseholdModal from '../components/HouseholdModal'

const mockGetHousehold = vi.fn()
const mockGetHouseholdMembers = vi.fn()
const mockLeaveHousehold = vi.fn()

vi.mock('../services/apiClient', () => ({
  api: {
    getHousehold: (...args) => mockGetHousehold(...args),
    getHouseholdMembers: (...args) => mockGetHouseholdMembers(...args),
    leaveHousehold: (...args) => mockLeaveHousehold(...args),
    createHousehold: vi.fn(),
    joinHousehold: vi.fn(),
    regenerateJoinCode: vi.fn(),
    removeHouseholdMember: vi.fn(),
  },
}))

vi.mock('../components/AdaptiveModal', () => ({
  default: ({ isOpen, children }) => (isOpen ? <div>{children}</div> : null),
}))

function renderModal(household, members) {
  mockGetHousehold.mockResolvedValue({ household })
  mockGetHouseholdMembers.mockResolvedValue({ members })
  mockLeaveHousehold.mockResolvedValue({})

  return render(
    <HouseholdModal isOpen userId="user-1" onClose={vi.fn()} />
  )
}

describe('HouseholdModal leave/delete confirm copy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
  })

  it('sole owner sees permanent delete warning', async () => {
    renderModal(
      { id: 'hh-1', name: 'Solo', role: 'owner', join_code: 'ABC123' },
      [{ user_id: 'user-1', role: 'owner' }]
    )

    await waitFor(() => {
      expect(screen.getByText('Delete Household')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Delete Household'))

    expect(window.confirm).toHaveBeenCalledWith(
      'Delete this household permanently? All pantry items, receipts, and meal history will be removed and cannot be recovered.'
    )
  })

  it('member sees leave warning without permanent delete language', async () => {
    renderModal(
      { id: 'hh-1', name: 'Shared', role: 'member', join_code: 'ABC123' },
      [
        { user_id: 'owner-1', role: 'owner' },
        { user_id: 'user-1', role: 'member' },
      ]
    )

    await waitFor(() => {
      expect(screen.getByText('Leave Household')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Leave Household'))

    expect(window.confirm).toHaveBeenCalledWith(
      'Leave this household? You will lose access to the shared pantry. Items will stay with the household.'
    )
  })
})
