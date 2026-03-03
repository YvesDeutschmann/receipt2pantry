import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CostcoOneTapSync from '../components/CostcoOneTapSync'

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'web',
    isNativePlatform: () => false,
  },
}))

vi.mock('../hooks/useCostcoSync', () => ({
  useCostcoSync: vi.fn(),
  STATUS: {
    IDLE: 'idle',
    AUTHENTICATING: 'authenticating',
    FETCHING: 'fetching',
    SUBMITTING: 'submitting',
    SUCCESS: 'success',
    ERROR: 'error',
  },
}))

import { useCostcoSync, STATUS } from '../hooks/useCostcoSync'

describe('CostcoOneTapSync', () => {
  const defaultHookReturn = {
    status: STATUS.IDLE,
    error: null,
    result: null,
    startSync: vi.fn(),
    startSilent: vi.fn(),
    hasStoredTokens: false,
    checkStoredTokens: vi.fn(),
    isNative: false,
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(useCostcoSync).mockReturnValue({ ...defaultHookReturn })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders non-native fallback message when not on native platform', () => {
    vi.mocked(useCostcoSync).mockReturnValue({ ...defaultHookReturn, isNative: false })
    render(<CostcoOneTapSync userId="test-user-id" />)
    expect(screen.getByText(/One-Tap Sync runs only on native iOS\/Android/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Sync Costco Receipts/ })).not.toBeInTheDocument()
  })

  it('renders sync button when on native platform', () => {
    vi.mocked(useCostcoSync).mockReturnValue({ ...defaultHookReturn, isNative: true })
    render(<CostcoOneTapSync userId="test-user-id" />)
    expect(screen.getByRole('button', { name: /Sync Costco Receipts/ })).toBeInTheDocument()
  })

  it('disables sync button during authenticating state', () => {
    vi.mocked(useCostcoSync).mockReturnValue({
      ...defaultHookReturn,
      isNative: true,
      status: STATUS.AUTHENTICATING,
    })
    render(<CostcoOneTapSync userId="test-user-id" />)
    const button = screen.getByRole('button', { name: /Sign in to Costco/ })
    expect(button).toBeDisabled()
  })

  it('disables sync button during fetching state', () => {
    vi.mocked(useCostcoSync).mockReturnValue({
      ...defaultHookReturn,
      isNative: true,
      status: STATUS.FETCHING,
    })
    render(<CostcoOneTapSync userId="test-user-id" />)
    const button = screen.getByRole('button', { name: /Fetching receipts/ })
    expect(button).toBeDisabled()
  })

  it('disables sync button during submitting state', () => {
    vi.mocked(useCostcoSync).mockReturnValue({
      ...defaultHookReturn,
      isNative: true,
      status: STATUS.SUBMITTING,
    })
    render(<CostcoOneTapSync userId="test-user-id" />)
    const button = screen.getByRole('button', { name: /Saving to pantry/ })
    expect(button).toBeDisabled()
  })

  it('shows Retry button when in error state', () => {
    vi.mocked(useCostcoSync).mockReturnValue({
      ...defaultHookReturn,
      isNative: true,
      status: STATUS.ERROR,
      error: 'Something went wrong',
    })
    render(<CostcoOneTapSync userId="test-user-id" />)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument()
  })

  it('shows success message when sync completes', () => {
    vi.mocked(useCostcoSync).mockReturnValue({
      ...defaultHookReturn,
      isNative: true,
      status: STATUS.SUCCESS,
      result: { count: 3, receipts_stored: 3, items_added_to_pantry: 0 },
    })
    render(<CostcoOneTapSync userId="test-user-id" />)
    expect(screen.getByText(/Sync complete/)).toBeInTheDocument()
    expect(screen.getByText(/3 receipt/)).toBeInTheDocument()
  })
})
