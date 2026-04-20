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

const { isNativePlatformMock } = vi.hoisted(() => ({
  isNativePlatformMock: vi.fn(() => true),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'ios',
    isNativePlatform: (...args) => isNativePlatformMock(...args),
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
    isNativePlatformMock.mockReturnValue(true)
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

  describe('group A — platform gating', () => {
    it('test_startSync_sets_ERROR_on_web_immediately', async () => {
      isNativePlatformMock.mockReturnValue(false)
      const { result } = renderHook(() => useCostcoSync(userId))

      await act(async () => {
        await result.current.startSync()
      })

      expect(result.current.status).toBe(STATUS.ERROR)
      expect(result.current.error).toBe(
        'One-Tap Sync requires a native app (iOS/Android). Run on device or emulator.'
      )
      expect(mockStartLogin).not.toHaveBeenCalled()
    })

    it('test_startSilent_sets_ERROR_on_web_immediately', async () => {
      isNativePlatformMock.mockReturnValue(false)
      const { result } = renderHook(() => useCostcoSync(userId))

      await act(async () => {
        await result.current.startSilent()
      })

      expect(result.current.status).toBe(STATUS.ERROR)
      expect(result.current.error).toBe('One-Tap Sync requires a native app.')
      expect(mockStartSilentSync).not.toHaveBeenCalled()
    })

    it('test_startSilent_sets_ERROR_when_userId_missing_on_native', async () => {
      const { result } = renderHook(() => useCostcoSync(undefined))

      await act(async () => {
        await result.current.startSilent()
      })

      expect(result.current.status).toBe(STATUS.ERROR)
      expect(result.current.error).toBe('Please sign in to sync receipts.')
      expect(mockStartSilentSync).not.toHaveBeenCalled()
    })
  })

  describe('group B — happy path (native)', () => {
    it('test_startSync_transitions_IDLE_AUTH_FETCH_SUBMIT_SUCCESS_on_happy_path', async () => {
      const receipts = [{ order_id: 'r1', total_amount: 50, items: [] }]

      let loginResolve
      mockStartLogin.mockImplementation(
        () =>
          new Promise((resolve) => {
            loginResolve = resolve
          })
      )

      let submitResolve
      mockSubmitToBackend.mockImplementation(
        () =>
          new Promise((resolve) => {
            submitResolve = resolve
          })
      )

      const { result } = renderHook(() => useCostcoSync(userId))

      await act(async () => {
        result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.AUTHENTICATING)
      })

      await act(async () => {
        loginResolve({
          idToken: 'token',
          receipts,
          _fromWebView: true,
        })
      })

      // FETCHING is set in the same synchronous turn as SUBMITTING before submit awaits;
      // React 18 batches these updates, so the hook typically commits SUBMITTING first.
      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.SUBMITTING)
      })

      await act(async () => {
        submitResolve({
          receipts_stored: 1,
          items_added_to_pantry: 0,
          errors: [],
        })
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.SUCCESS)
      })
    })

    it('test_result_contains_receipts_count_receipts_stored_items_added', async () => {
      const receipts = [
        { order_id: 'r1', total_amount: 50, items: [] },
        { order_id: 'r2', total_amount: 60, items: [] },
      ]
      mockStartLogin.mockResolvedValue({
        idToken: 'token',
        receipts,
        _fromWebView: true,
      })
      mockSubmitToBackend.mockResolvedValue({
        receipts_stored: 2,
        items_added_to_pantry: 7,
        errors: [{ line: 'x' }],
      })

      const { result } = renderHook(() => useCostcoSync(userId))

      await act(async () => {
        result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.SUCCESS)
      })

      expect(result.current.result.receipts).toEqual(receipts)
      expect(result.current.result.count).toBe(2)
      expect(result.current.result.receipts_stored).toBe(2)
      expect(result.current.result.items_added_to_pantry).toBe(7)
      expect(result.current.result.errors).toEqual([{ line: 'x' }])
    })

    it('test_triggerGeneration_fires_when_items_added_gt_3', async () => {
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

    it('test_triggerGeneration_does_not_fire_when_items_added_eq_3', async () => {
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

  describe('group C — auth-error branches', () => {
    const receipts = [{ order_id: 'r1', total_amount: 50, items: [] }]

    async function seedHasStoredTokens() {
      mockHasStoredTokens.mockResolvedValue(true)
      const { result } = renderHook(() => useCostcoSync(userId))
      await act(async () => {
        await result.current.checkStoredTokens()
      })
      expect(result.current.hasStoredTokens).toBe(true)
      return { result }
    }

    it('test_401_error_message_clears_tokens', async () => {
      mockStartLogin.mockResolvedValue({
        idToken: 'token',
        receipts,
        _fromWebView: true,
      })
      mockSubmitToBackend.mockRejectedValue(new Error('Backend returned 401 Unauthorized'))

      const { result } = await seedHasStoredTokens()

      await act(async () => {
        result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.ERROR)
      })

      expect(result.current.error).toBe('Backend returned 401 Unauthorized')
      expect(mockClearStoredTokens).toHaveBeenCalled()
      expect(result.current.hasStoredTokens).toBe(false)
    })

    it('test_403_error_message_clears_tokens', async () => {
      mockStartLogin.mockResolvedValue({
        idToken: 'token',
        receipts,
        _fromWebView: true,
      })
      mockSubmitToBackend.mockRejectedValue(new Error('Access denied: HTTP 403 Forbidden'))

      const { result } = await seedHasStoredTokens()

      await act(async () => {
        result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.ERROR)
      })

      expect(result.current.error).toBe('Access denied: HTTP 403 Forbidden')
      expect(mockClearStoredTokens).toHaveBeenCalled()
      expect(result.current.hasStoredTokens).toBe(false)
    })

    it('test_token_expired_error_message_clears_tokens', async () => {
      mockStartLogin.mockResolvedValue({
        idToken: 'token',
        receipts,
        _fromWebView: true,
      })
      mockSubmitToBackend.mockRejectedValue(
        new Error('Costco token expired — please sign in again')
      )

      const { result } = await seedHasStoredTokens()

      await act(async () => {
        result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.ERROR)
      })

      expect(result.current.error).toBe(
        'Costco token expired — please sign in again'
      )
      expect(mockClearStoredTokens).toHaveBeenCalled()
      expect(result.current.hasStoredTokens).toBe(false)
    })

    it('test_65535_error_message_clears_tokens', async () => {
      mockStartLogin.mockResolvedValue({
        idToken: 'token',
        receipts,
        _fromWebView: true,
      })
      mockSubmitToBackend.mockRejectedValue(
        new Error('WebView bridge failed with status 65535 (session invalid)')
      )

      const { result } = await seedHasStoredTokens()

      await act(async () => {
        result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.ERROR)
      })

      expect(result.current.error).toBe(
        'WebView bridge failed with status 65535 (session invalid)'
      )
      expect(mockClearStoredTokens).toHaveBeenCalled()
      expect(result.current.hasStoredTokens).toBe(false)
    })

    it('test_network_timeout_error_preserves_tokens', async () => {
      mockStartLogin.mockResolvedValue({
        idToken: 'token',
        receipts,
        _fromWebView: true,
      })
      mockSubmitToBackend.mockRejectedValue(new Error('Network timeout — please try again'))

      const { result } = await seedHasStoredTokens()

      await act(async () => {
        result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.ERROR)
      })

      expect(mockClearStoredTokens).not.toHaveBeenCalled()
      expect(result.current.hasStoredTokens).toBe(true)
    })
  })

  describe('group D — best-effort calls', () => {
    it('test_connect_from_app_failure_only_warns_not_errors', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const receipts = [{ order_id: 'r1', total_amount: 50, items: [] }]
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
      mockConnectCostcoFromApp.mockRejectedValue(new Error('connect-from-app failed'))

      const { result } = renderHook(() => useCostcoSync(userId))

      await act(async () => {
        result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.SUCCESS)
      })

      expect(warnSpy).toHaveBeenCalled()
      expect(result.current.error).toBeNull()
      warnSpy.mockRestore()
    })

    it('test_triggerGeneration_failure_does_not_flip_state_to_error', async () => {
      const receipts = [{ order_id: 'r1', total_amount: 50, items: [] }]
      mockStartLogin.mockResolvedValue({
        idToken: 'token',
        receipts,
        _fromWebView: true,
      })
      mockSubmitToBackend.mockResolvedValue({
        receipts_stored: 1,
        items_added_to_pantry: 5,
        errors: [],
      })
      mockTriggerGeneration.mockRejectedValue(new Error('triggerGeneration unavailable'))

      const { result } = renderHook(() => useCostcoSync(userId))

      await act(async () => {
        result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.SUCCESS)
      })

      expect(result.current.error).toBeNull()
      expect(mockTriggerGeneration).toHaveBeenCalled()
    })
  })

  describe('group E — silent path', () => {
    it('test_startSilent_sets_empty_result_when_no_receipts_returned', async () => {
      mockStartSilentSync.mockResolvedValue({ receipts: [] })

      const { result } = renderHook(() => useCostcoSync(userId))

      await act(async () => {
        await result.current.startSilent()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.SUCCESS)
      })

      expect(result.current.result).toEqual({
        receipts: [],
        count: 0,
        receipts_stored: 0,
        items_added_to_pantry: 0,
        errors: [],
      })
      expect(mockSubmitToBackend).not.toHaveBeenCalled()
    })

    it('test_startSilent_clears_tokens_on_any_thrown_error', async () => {
      mockStartSilentSync.mockRejectedValue(new Error('silent sync crashed'))

      const { result } = renderHook(() => useCostcoSync(userId))

      await act(async () => {
        await result.current.startSilent()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.ERROR)
      })

      expect(mockClearStoredTokens).toHaveBeenCalled()
      expect(result.current.hasStoredTokens).toBe(false)
      expect(result.current.error).toMatch(/silent sync crashed/)
    })
  })
})
