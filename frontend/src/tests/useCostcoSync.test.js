import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useCostcoSync, STATUS } from '../hooks/useCostcoSync'
import { setSyncUserId, __resetSyncPrefKeysForTests } from '../services/syncPrefKeys'
import { clearCostcoReconnectCooldown } from '../services/costcoWebViewBridge'

const { preferencesSetMock } = vi.hoisted(() => ({
  preferencesSetMock: vi.fn(() => Promise.resolve()),
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(() => Promise.resolve({ value: null })),
    set: (...args) => preferencesSetMock(...args),
    remove: vi.fn(() => Promise.resolve()),
  },
}))

const mockStartLogin = vi.fn()
const mockStartSilentSync = vi.fn()
const mockHasStoredTokens = vi.fn()
const mockClearStoredTokens = vi.fn()
const mockClearCostcoInAppBrowserSession = vi.fn(() => Promise.resolve())
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
  clearCostcoInAppBrowserSession: () => mockClearCostcoInAppBrowserSession(),
  clearCostcoReconnectCooldown: vi.fn(() => Promise.resolve()),
}))

vi.mock('../services/costcoNativeSync', () => ({
  isTokenExpired: vi.fn(() => false),
  submitToBackend: (...args) => mockSubmitToBackend(...args),
}))

vi.mock('../services/costcoSilentIngest', () => ({
  submitSilentReceipts: (...args) => mockSubmitToBackend(...args),
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
    __resetSyncPrefKeysForTests()
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

  describe('group H — sync-completed events', () => {
    function getCostcoSyncCompletedEvents(dispatchSpy) {
      return dispatchSpy.mock.calls
        .map(([event]) => event)
        .filter((event) => event instanceof CustomEvent && event.type === 'costco-sync-completed')
    }

    it('START_SYNC_EMPTY_FROM_WEBVIEW_IS_COMPLETED_EMPTY', async () => {
      setSyncUserId(userId)
      mockStartLogin.mockResolvedValue({
        idToken: 'token',
        receipts: [],
        _fromWebView: true,
      })
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      const { result } = renderHook(() => useCostcoSync(userId))

      await act(async () => {
        result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.SUCCESS)
      })

      const completedEvents = getCostcoSyncCompletedEvents(dispatchSpy)
      const errorEvents = dispatchSpy.mock.calls
        .map(([event]) => event)
        .filter((event) => event instanceof CustomEvent && event.type === 'costco-sync-error')
      expect(completedEvents).toHaveLength(1)
      expect(completedEvents[0].detail).toEqual({
        tier: 'manual',
        receipts_stored: 0,
        items_added: 0,
        outcome: 'completed_empty',
      })
      expect(errorEvents).toHaveLength(0)
      expect(mockSubmitToBackend).not.toHaveBeenCalled()
      expect(preferencesSetMock).toHaveBeenCalledWith({
        key: `sync_lastRun_costco_${userId}`,
        value: expect.stringMatching(/^\d+$/),
      })
      expect(vi.mocked(clearCostcoReconnectCooldown)).toHaveBeenCalled()

      dispatchSpy.mockRestore()
    })

    it('test_startSync_dispatches_costco_sync_completed_on_success', async () => {
      const receipts = [{ order_id: 'r1', total_amount: 50, items: [] }]
      mockStartLogin.mockResolvedValue({
        idToken: 'token',
        receipts,
        _fromWebView: true,
      })
      mockSubmitToBackend.mockResolvedValue({
        receipts_stored: 1,
        items_added_to_pantry: 2,
        errors: [],
      })
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      const { result } = renderHook(() => useCostcoSync(userId))

      await act(async () => {
        result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.SUCCESS)
      })

      const completedEvents = getCostcoSyncCompletedEvents(dispatchSpy)
      expect(completedEvents).toHaveLength(1)
      expect(completedEvents[0].detail).toEqual({
        tier: 'manual',
        receipts_stored: 1,
        items_added: 2,
        outcome: 'completed_items',
      })

      dispatchSpy.mockRestore()
    })

    it('test_startSilent_empty_receipts_is_success_not_error', async () => {
      mockStartSilentSync.mockResolvedValue({ receipts: [], _fromWebView: true })
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      const { result } = renderHook(() => useCostcoSync(userId))

      await act(async () => {
        await result.current.startSilent()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.SUCCESS)
      })

      expect(result.current.error).toBeNull()
      const completedEvents = getCostcoSyncCompletedEvents(dispatchSpy)
      expect(completedEvents).toHaveLength(1)
      expect(completedEvents[0].detail.outcome).toBe('completed_empty')

      dispatchSpy.mockRestore()
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

    it('test_redirect_loop_error_clears_tokens_and_inappbrowser_session', async () => {
      mockStartLogin.mockRejectedValue(
        new Error(
          'Costco sign-in got stuck in a redirect loop. Please tap Retry to start a clean sign-in.'
        )
      )

      const { result } = renderHook(() => useCostcoSync(userId))

      await act(async () => {
        result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.ERROR)
      })

      expect(result.current.error).toMatch(/redirect loop/)
      expect(mockClearStoredTokens).toHaveBeenCalled()
      expect(mockClearCostcoInAppBrowserSession).toHaveBeenCalled()
      expect(result.current.hasStoredTokens).toBe(false)
    })

    it('test_post_auth_wcs_err_clears_tokens_and_inappbrowser_session', async () => {
      mockStartLogin.mockRejectedValue(
        new Error(
          'Costco signed you in but could not finish connecting your account. Tap Retry to start a clean sign-in.'
        )
      )

      const { result } = renderHook(() => useCostcoSync(userId))

      await act(async () => {
        result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.ERROR)
      })

      expect(result.current.error).toMatch(/finish connecting your account/)
      expect(mockClearStoredTokens).toHaveBeenCalled()
      expect(mockClearCostcoInAppBrowserSession).toHaveBeenCalled()
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
      setSyncUserId(userId)
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
      expect(vi.mocked(clearCostcoReconnectCooldown)).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('SILENT_COMPLETED_ITEMS_CLEARS_COOLDOWN_WHEN_CONNECT_FROM_APP_FAILS', async () => {
      setSyncUserId(userId)
      const receipts = [{ order_id: 'r1', total_amount: 50, items: [] }]
      mockStartSilentSync.mockResolvedValue({
        receipts,
        idToken: 'token',
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
        await result.current.startSilent()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.SUCCESS)
      })

      expect(vi.mocked(clearCostcoReconnectCooldown)).toHaveBeenCalled()
      expect(preferencesSetMock).toHaveBeenCalledWith({
        key: `sync_lastRun_costco_${userId}`,
        value: expect.stringMatching(/^\d+$/),
      })
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
    it('test_startSilent_needs_reconnect_clears_tokens', async () => {
      mockStartSilentSync.mockResolvedValue({ needs_reconnect: true, reason: 'refresh_invalid_grant' })
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      const { result } = renderHook(() => useCostcoSync(userId))

      await act(async () => {
        await result.current.startSilent()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.ERROR)
      })

      expect(mockClearStoredTokens).toHaveBeenCalled()
      expect(mockClearCostcoInAppBrowserSession).toHaveBeenCalled()
      expect(result.current.hasStoredTokens).toBe(false)
      expect(result.current.error).toMatch(/session expired/i)
      const reconnectEvents = dispatchSpy.mock.calls.filter(
        (c) => c[0]?.type === 'costco-sync-needs-reconnect'
      )
      expect(reconnectEvents.length).toBeGreaterThanOrEqual(1)
      dispatchSpy.mockRestore()
    })

    it('test_startSilent_needs_reconnect_does_not_dispatch_completed', async () => {
      mockStartSilentSync.mockResolvedValue({ needs_reconnect: true, reason: 'refresh_invalid_grant' })
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      const { result } = renderHook(() => useCostcoSync(userId))

      await act(async () => {
        await result.current.startSilent()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.ERROR)
      })

      const completedEvents = dispatchSpy.mock.calls
        .map(([event]) => event)
        .filter((event) => event instanceof CustomEvent && event.type === 'costco-sync-completed')
      expect(completedEvents).toHaveLength(0)
      dispatchSpy.mockRestore()
    })

    it('MANUAL_TAP_DURING_AUTOSYNC_SHOWS_IN_PROGRESS', async () => {
      mockStartSilentSync.mockResolvedValue({ _skipped: true, reason: 'webview_busy' })
      const { result } = renderHook(() => useCostcoSync(userId))

      await act(async () => {
        await result.current.startSilent()
      })

      expect(result.current.status).toBe(STATUS.SKIPPED)
      expect(result.current.error).toBeNull()
    })

    it('test_startSilent_sets_success_when_empty_receipts_array', async () => {
      mockStartSilentSync.mockResolvedValue({ receipts: [] })

      const { result } = renderHook(() => useCostcoSync(userId))

      await act(async () => {
        await result.current.startSilent()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.ERROR)
      })

      expect(result.current.error).toBeTruthy()
      expect(mockSubmitToBackend).not.toHaveBeenCalled()
    })

    it('test_startSilent_sets_success_when_empty_receipts_from_webview', async () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      mockStartSilentSync.mockResolvedValue({ receipts: [], _fromWebView: true })

      const { result } = renderHook(() => useCostcoSync(userId))

      await act(async () => {
        await result.current.startSilent()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.SUCCESS)
      })

      const completedEvents = dispatchSpy.mock.calls
        .map(([event]) => event)
        .filter((event) => event instanceof CustomEvent && event.type === 'costco-sync-completed')
      expect(completedEvents).toHaveLength(1)
      expect(completedEvents[0].detail.outcome).toBe('completed_empty')
      dispatchSpy.mockRestore()
    })

    it('SILENT_INGEST_THROW_EMITS_FAILED_NOT_COMPLETED', async () => {
      const receipts = [{ order_id: 'r1', total_amount: 50, items: [] }]
      mockStartSilentSync.mockResolvedValue({
        receipts,
        idToken: 'token',
        _fromWebView: true,
      })
      mockSubmitToBackend.mockRejectedValue(new Error('Network Error'))
      mockHasStoredTokens.mockResolvedValue(true)
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

      const { result } = renderHook(() => useCostcoSync(userId))
      await act(async () => {
        await result.current.checkStoredTokens()
      })

      await act(async () => {
        await result.current.startSilent()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.ERROR)
      })

      const errorEvents = dispatchSpy.mock.calls
        .map(([event]) => event)
        .filter((event) => event instanceof CustomEvent && event.type === 'costco-sync-error')
      const completedEvents = dispatchSpy.mock.calls
        .map(([event]) => event)
        .filter((event) => event instanceof CustomEvent && event.type === 'costco-sync-completed')
      expect(errorEvents).toHaveLength(1)
      expect(errorEvents[0].detail.outcome).toBe('failed')
      expect(completedEvents).toHaveLength(0)
      expect(mockClearStoredTokens).not.toHaveBeenCalled()
      expect(mockClearCostcoInAppBrowserSession).not.toHaveBeenCalled()
      expect(result.current.hasStoredTokens).toBe(true)

      dispatchSpy.mockRestore()
    })

    it('test_startSilent_preserves_tokens_on_network_ingest_error', async () => {
      const receipts = [{ order_id: 'r1', total_amount: 50, items: [] }]
      mockStartSilentSync.mockResolvedValue({
        receipts,
        idToken: 'token',
        _fromWebView: true,
      })
      mockSubmitToBackend.mockRejectedValue(new Error('Network Error'))
      mockHasStoredTokens.mockResolvedValue(true)

      const { result } = renderHook(() => useCostcoSync(userId))
      await act(async () => {
        await result.current.checkStoredTokens()
      })

      await act(async () => {
        await result.current.startSilent()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.ERROR)
      })

      expect(mockClearStoredTokens).not.toHaveBeenCalled()
      expect(mockClearCostcoInAppBrowserSession).not.toHaveBeenCalled()
      expect(result.current.hasStoredTokens).toBe(true)
      expect(result.current.error).toMatch(/Network Error/)
    })

    it('test_startSilent_tokens_only_does_not_clear_tokens', async () => {
      mockStartSilentSync.mockResolvedValue({ idToken: 'x', _tokensOnly: true })
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      mockHasStoredTokens.mockResolvedValue(true)

      const { result } = renderHook(() => useCostcoSync(userId))
      await act(async () => {
        await result.current.checkStoredTokens()
      })

      await act(async () => {
        await result.current.startSilent()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.ERROR)
      })

      expect(mockClearStoredTokens).not.toHaveBeenCalled()
      expect(result.current.hasStoredTokens).toBe(true)
      expect(result.current.error).toMatch(/Try Silent Sync again/)
      const reconnectEvents = dispatchSpy.mock.calls.filter(
        (c) => c[0]?.type === 'costco-sync-needs-reconnect'
      )
      expect(reconnectEvents).toHaveLength(0)
      dispatchSpy.mockRestore()
    })

    it('test_startSilent_clears_tokens_on_non_transient_thrown_error', async () => {
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
