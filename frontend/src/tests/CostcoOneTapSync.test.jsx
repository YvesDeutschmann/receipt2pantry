import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import CostcoOneTapSync from '../components/CostcoOneTapSync'

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'web',
    isNativePlatform: () => false,
  },
}))

const { subscribeHealthMock } = vi.hoisted(() => ({
  subscribeHealthMock: vi.fn((listener) => {
    listener({})
    return () => {}
  }),
}))

vi.mock('../services/syncHealthStore', () => ({
  subscribeHealth: (...args) => subscribeHealthMock(...args),
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
    SKIPPED: 'skipped',
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
    subscribeHealthMock.mockImplementation((listener) => {
      listener({})
      return () => {}
    })
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

  it('HIDES_HEALTH_WHEN_NO_RECORD', () => {
    vi.mocked(useCostcoSync).mockReturnValue({ ...defaultHookReturn, isNative: true })
    render(<CostcoOneTapSync userId="test-user-id" />)
    expect(screen.queryByText(/Last synced/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Sync in progress/i)).not.toBeInTheDocument()
  })

  it('RENDERS_NO_NEW_RECEIPTS_ON_COMPLETED_EMPTY', () => {
    subscribeHealthMock.mockImplementation((listener) => {
      listener({
        costco: {
          lastAttemptAt: Date.now() - 60_000,
          lastOutcome: 'completed_empty',
          lastCompletedAt: Date.now() - 60_000,
          receiptsStored: 0,
          lastToastedOutcome: null,
        },
      })
      return () => {}
    })
    vi.mocked(useCostcoSync).mockReturnValue({ ...defaultHookReturn, isNative: true })
    render(<CostcoOneTapSync userId="test-user-id" />)
    expect(screen.getByText(/No new receipts · Last synced/i)).toBeInTheDocument()
  })

  it('RENDERS_LAST_SYNC_AT_WHEN_HEALTH_PRESENT', () => {
    subscribeHealthMock.mockImplementation((listener) => {
      listener({
        costco: {
          lastAttemptAt: Date.now() - 120_000,
          lastOutcome: 'completed_items',
          lastCompletedAt: Date.now() - 120_000,
          receiptsStored: 2,
          lastToastedOutcome: null,
        },
      })
      return () => {}
    })
    vi.mocked(useCostcoSync).mockReturnValue({ ...defaultHookReturn, isNative: true })
    render(<CostcoOneTapSync userId="test-user-id" />)
    expect(screen.getByText(/Synced 2 receipts · Last synced/i)).toBeInTheDocument()
  })

  it('RENDERS_SYNC_IN_PROGRESS_ON_SKIPPED_STATUS', () => {
    vi.mocked(useCostcoSync).mockReturnValue({
      ...defaultHookReturn,
      isNative: true,
      status: STATUS.SKIPPED,
    })
    render(<CostcoOneTapSync userId="test-user-id" />)
    expect(screen.getByText('Sync in progress')).toBeInTheDocument()
  })

  it('RECONNECT_BANNER_MOUNTED_IN_COSTCO_CARD', () => {
    vi.mocked(useCostcoSync).mockReturnValue({ ...defaultHookReturn, isNative: true })
    render(<CostcoOneTapSync userId="test-user-id" />)
    act(() => {
      window.dispatchEvent(new CustomEvent('costco-sync-needs-reconnect'))
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reconnect Costco/ })).toBeInTheDocument()
  })

  it('RECONNECT_BANNER_CALLS_START_SYNC_IN_COSTCO_CARD', () => {
    const startSync = vi.fn()
    vi.mocked(useCostcoSync).mockReturnValue({
      ...defaultHookReturn,
      isNative: true,
      startSync,
    })
    render(<CostcoOneTapSync userId="test-user-id" />)
    act(() => {
      window.dispatchEvent(new CustomEvent('costco-sync-needs-reconnect'))
    })
    fireEvent.click(screen.getByRole('button', { name: /Reconnect Costco/ }))
    expect(startSync).toHaveBeenCalledOnce()
  })
})
