import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useCostcoSync, STATUS } from '../hooks/useCostcoSync'

const mockStartLogin = vi.fn()
const mockStartSilentSync = vi.fn()
const mockHasStoredTokens = vi.fn()
const mockClearStoredTokens = vi.fn()
const mockSubmitToBackend = vi.fn()
const mockConnectCostcoFromApp = vi.fn()
const mockTriggerGeneration = vi.fn(() => Promise.resolve({ status: 'completed' }))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'ios',
    isNativePlatform: () => true,
  },
}))

vi.mock('../services/costcoWebViewBridge', () => ({
  getStoredTokens: vi.fn(),
  hasStoredTokens: () => mockHasStoredTokens(),
  startLogin: () => mockStartLogin(),
  startSilentSync: () => mockStartSilentSync(),
  clearStoredTokens: () => mockClearStoredTokens(),
}))

vi.mock('../services/costcoNativeSync', () => ({
  isTokenExpired: vi.fn(() => false),
  submitToBackend: (...args) => mockSubmitToBackend(...args),
}))

vi.mock('../services/apiClient', () => ({
  api: {
    connectCostcoFromApp: (...args) => mockConnectCostcoFromApp(...args),
    getSuggestions: vi.fn(() =>
      Promise.resolve({
        use_soon_shelf: [],
        cook_tonight: [],
        probably_have: [],
        check_first: [],
      })
    ),
    getPantry: vi.fn(),
    getHousehold: vi.fn(),
    suggestions: {
      triggerGeneration: (...args) => mockTriggerGeneration(...args),
    },
  },
}))

describe('useCostcoSync', () => {
  const userId = '11111111-1111-1111-1111-111111111111'

  beforeEach(() => {
    vi.clearAllMocks()
    mockHasStoredTokens.mockResolvedValue(false)
    mockClearStoredTokens.mockResolvedValue(undefined)
    mockConnectCostcoFromApp.mockResolvedValue({})
    mockTriggerGeneration.mockResolvedValue({ status: 'completed' })
  })

  it('starts in IDLE status', () => {
    const { result } = renderHook(() => useCostcoSync(userId))
    expect(result.current.status).toBe(STATUS.IDLE)
    expect(result.current.error).toBeNull()
    expect(result.current.result).toBeNull()
  })

  it('transitions to SUCCESS when startSync receives receipts from WebView', async () => {
    const receipts = [
      { order_id: 'r1', total_amount: 50, items: [] },
    ]
    mockStartLogin.mockResolvedValue({
      idToken: 'token',
      receipts,
      _fromWebView: true,
    })
    mockSubmitToBackend.mockResolvedValue({
      receipts_stored: 1,
      items_added_to_pantry: 0,
      errors: [],
    })

    const { result } = renderHook(() => useCostcoSync(userId))

    await act(async () => {
      result.current.startSync()
    })

    await waitFor(() => {
      expect(result.current.status).toBe(STATUS.SUCCESS)
    })

    expect(result.current.result).toBeDefined()
    expect(result.current.result.count).toBe(1)
    expect(mockSubmitToBackend).toHaveBeenCalledWith(receipts, userId)
    expect(mockConnectCostcoFromApp).toHaveBeenCalled()
  })

  it('sets error when WebView returns tokens only (no receipts)', async () => {
    mockStartLogin.mockResolvedValue({
      idToken: 'token',
      _closeWebViewAfterFetch: true,
    })

    const { result } = renderHook(() => useCostcoSync(userId))

    await act(async () => {
      result.current.startSync()
    })

    await waitFor(() => {
      expect(result.current.status).toBe(STATUS.ERROR)
    })

    expect(result.current.error).toMatch(/Could not fetch receipts/)
    expect(result.current.error).toMatch(/Orders & Purchases/)
    expect(mockSubmitToBackend).not.toHaveBeenCalled()
  })

  it('checkStoredTokens updates hasStoredTokens state', async () => {
    mockHasStoredTokens.mockResolvedValue(true)

    const { result } = renderHook(() => useCostcoSync(userId))

    await act(async () => {
      await result.current.checkStoredTokens()
    })

    expect(result.current.hasStoredTokens).toBe(true)
  })

  it('triggers suggestion pool generation when items_added_to_pantry is greater than 3', async () => {
    const receipts = [{ order_id: 'r1', total_amount: 50, items: [] }]
    mockStartLogin.mockResolvedValue({
      idToken: 'token',
      receipts,
      _fromWebView: true,
    })
    mockSubmitToBackend.mockResolvedValue({
      receipts_stored: 1,
      items_added_to_pantry: 4,
      errors: [],
    })

    const { result } = renderHook(() => useCostcoSync(userId))

    await act(async () => {
      result.current.startSync()
    })

    await waitFor(() => {
      expect(result.current.status).toBe(STATUS.SUCCESS)
    })

    expect(mockTriggerGeneration).toHaveBeenCalledWith(userId, {
      triggerReason: 'receipt_scan',
    })
  })

  it('does not trigger pool generation when exactly 3 items added to pantry', async () => {
    const receipts = [{ order_id: 'r1', total_amount: 50, items: [] }]
    mockStartLogin.mockResolvedValue({
      idToken: 'token',
      receipts,
      _fromWebView: true,
    })
    mockSubmitToBackend.mockResolvedValue({
      receipts_stored: 1,
      items_added_to_pantry: 3,
      errors: [],
    })

    const { result } = renderHook(() => useCostcoSync(userId))

    await act(async () => {
      result.current.startSync()
    })

    await waitFor(() => {
      expect(result.current.status).toBe(STATUS.SUCCESS)
    })

    expect(mockTriggerGeneration).not.toHaveBeenCalled()
  })
})
