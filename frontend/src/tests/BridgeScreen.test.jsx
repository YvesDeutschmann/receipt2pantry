import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import BridgeScreen from '../pages/onboarding/BridgeScreen'

const mockCompleteBridge = vi.fn()
const mockNavigate = vi.fn()

vi.mock('../contexts/OnboardingContext', () => ({
  useOnboarding: () => ({
    completeBridge: (...args) => mockCompleteBridge(...args),
  }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

function renderBridge() {
  return render(
    <MemoryRouter initialEntries={['/onboarding/bridge']}>
      <Routes>
        <Route path="/onboarding/bridge" element={<BridgeScreen />} />
        <Route path="/providers" element={<div>Providers page</div>} />
        <Route path="/onboarding/pantry-setup" element={<div>Pantry setup page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('BridgeScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCompleteBridge.mockResolvedValue(true)
  })

  it('shows optional-connect copy and not required-connect copy', () => {
    renderBridge()

    expect(
      screen.getByText(
        /Connect a store to fill your pantry from recent receipts, or add items yourself/i
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(/You'll get dinner suggestions either way/i)
    ).toBeInTheDocument()
    expect(screen.queryByText(/you'll come right back/i)).not.toBeInTheDocument()
    expect(
      screen.queryByText(/suggestions will be ready after that/i)
    ).not.toBeInTheDocument()
  })

  it('renders connect as primary and manual as secondary button', () => {
    renderBridge()

    const connect = screen.getByRole('button', { name: /connect my grocery store/i })
    const manual = screen.getByRole('button', { name: /i'll add items manually/i })

    expect(connect).toHaveClass('btn-primary')
    expect(manual).toHaveClass('btn-secondary')
  })

  it('connect path calls completeBridge with provider meta and navigates to /providers', async () => {
    const user = userEvent.setup()
    renderBridge()

    await user.click(screen.getByRole('button', { name: /connect my grocery store/i }))

    await waitFor(() => {
      expect(mockCompleteBridge).toHaveBeenCalledWith({
        cold_start_skip_grocery: false,
        bridge_chose_providers: true,
      })
    })
    expect(mockNavigate).toHaveBeenCalledWith('/providers', { replace: true })
  })

  it('manual path calls completeBridge with skip meta and navigates to pantry-setup', async () => {
    const user = userEvent.setup()
    renderBridge()

    await user.click(screen.getByRole('button', { name: /i'll add items manually/i }))

    await waitFor(() => {
      expect(mockCompleteBridge).toHaveBeenCalledWith({
        cold_start_skip_grocery: true,
        bridge_chose_manual: true,
        cold_start_grocery_connected: true,
      })
    })
    expect(mockNavigate).toHaveBeenCalledWith('/onboarding/pantry-setup', {
      replace: true,
    })
  })

  it('double-activate before first promise resolves calls completeBridge once', async () => {
    let resolveBridge
    mockCompleteBridge.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBridge = () => resolve(true)
        })
    )

    const user = userEvent.setup()
    renderBridge()

    const connect = screen.getByRole('button', { name: /connect my grocery store/i })
    const manual = screen.getByRole('button', { name: /i'll add items manually/i })

    await user.click(connect)
    await user.click(manual)

    expect(mockCompleteBridge).toHaveBeenCalledTimes(1)
    expect(mockCompleteBridge).toHaveBeenCalledWith({
      cold_start_skip_grocery: false,
      bridge_chose_providers: true,
    })

    resolveBridge()
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/providers', { replace: true })
    })
  })

  it('failed manual tap shows static error and does not navigate to providers', async () => {
    mockCompleteBridge.mockRejectedValue(new Error('network down'))

    const user = userEvent.setup()
    renderBridge()

    await user.click(screen.getByRole('button', { name: /i'll add items manually/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i)
    })

    expect(mockNavigate).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /providers/i })).not.toBeInTheDocument()

    const connect = screen.getByRole('button', { name: /connect my grocery store/i })
    const manual = screen.getByRole('button', { name: /i'll add items manually/i })
    expect(connect).not.toBeDisabled()
    expect(manual).not.toBeDisabled()
  })

  it('shows Working… not Connecting… while in flight', async () => {
    let resolveBridge
    mockCompleteBridge.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBridge = () => resolve(true)
        })
    )

    const user = userEvent.setup()
    renderBridge()

    await user.click(screen.getByRole('button', { name: /i'll add items manually/i }))

    expect(screen.getByText(/working/i)).toBeInTheDocument()
    expect(screen.queryByText(/connecting/i)).not.toBeInTheDocument()

    resolveBridge()
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled()
    })
  })
})
