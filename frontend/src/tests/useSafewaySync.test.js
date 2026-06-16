import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSafewaySync, STATUS } from '../hooks/useSafewaySync'
import { api } from '../services/apiClient'
import {
  clearStoredTokens,
  hasStoredTokens,
  startSilentSync,
} from '../services/safewayWebViewBridge'

const mockStartLogin = vi.fn()
const mockFetchSafewayReceipts = vi.fn()
const mockTriggerGeneration = vi.fn(() => Promise.resolve({ status: 'completed' }))
const mockIngestReceipts = vi.fn()

const { isNativePlatformMock } = vi.hoisted(() => ({
  isNativePlatformMock: vi.fn(() => true),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'ios',
    isNativePlatform: (...args) => isNativePlatformMock(...args),
  },
}))

vi.mock('../services/safewayWebViewBridge', () => ({
  hasStoredTokens: vi.fn(() => Promise.resolve(false)),
  startLogin: (...args) => mockStartLogin(...args),
  startSilentSync: vi.fn(),
  clearStoredTokens: vi.fn(),
  fetchSafewayReceipts: (...args) => mockFetchSafewayReceipts(...args),
}))

vi.mock('../services/safewayReceiptParser', () => ({
  parseSafewayReceipt: (r) => r,
}))

vi.mock('../services/apiClient', () => ({
  api: {
    getReceipts: vi.fn(() => Promise.resolve({ receipts: [] })),
    ingestReceipts: (...args) => mockIngestReceipts(...args),
    suggestions: {
      triggerGeneration: (...args) => mockTriggerGeneration(...args),
    },
  },
}))

const userId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

describe('useSafewaySync — Test-First Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isNativePlatformMock.mockReturnValue(true)
    vi.mocked(hasStoredTokens).mockResolvedValue(false)
    vi.mocked(clearStoredTokens).mockResolvedValue(undefined)
    vi.mocked(startSilentSync).mockResolvedValue(null)
    mockStartLogin.mockResolvedValue({
      accessToken: 'tok',
      clubCard: '12345',
    })
    mockFetchSafewayReceipts.mockResolvedValue([{ order_id: 'o1' }])
    mockIngestReceipts.mockResolvedValue({
      receipts_stored: 1,
      items_added_to_pantry: 0,
      errors: [],
    })
    vi.mocked(api.getReceipts).mockResolvedValue({ receipts: [] })
    mockTriggerGeneration.mockResolvedValue({ status: 'completed' })
  })

  describe('group A — platform & auth preconditions', () => {
    it('test_startSync_sets_ERROR_on_web', async () => {
      isNativePlatformMock.mockReturnValue(false)
      const { result } = renderHook(() => useSafewaySync(userId))

      await act(async () => {
        await result.current.startSync()
      })

      expect(result.current.status).toBe(STATUS.ERROR)
      expect(result.current.error).toBe(
        'Connect Safeway requires a native app (iOS/Android). Run on device or emulator.'
      )
      expect(mockStartLogin).not.toHaveBeenCalled()
    })

    it('test_startSilent_requires_userId_on_native', async () => {
      const { result } = renderHook(() => useSafewaySync(undefined))

      await act(async () => {
        await result.current.startSilent()
      })

      expect(result.current.status).toBe(STATUS.ERROR)
      expect(result.current.error).toBe('Please sign in to sync receipts.')
      expect(vi.mocked(startSilentSync)).not.toHaveBeenCalled()
    })

    it('test_missing_accessToken_surfaces_error_and_does_not_clear_tokens', async () => {
      mockStartLogin.mockResolvedValue({
        clubCard: '12345',
      })

      const { result } = renderHook(() => useSafewaySync(userId))

      await act(async () => {
        await result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.ERROR)
      })

      expect(result.current.error).toMatch(/Safeway login did not complete/)
      expect(vi.mocked(clearStoredTokens)).not.toHaveBeenCalled()
    })

    it('test_missing_clubCard_surfaces_error', async () => {
      mockStartLogin.mockResolvedValue({
        accessToken: 'tok-only',
      })

      const { result } = renderHook(() => useSafewaySync(userId))

      await act(async () => {
        await result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.ERROR)
      })

      expect(result.current.error).toMatch(/club card/i)
    })
  })

  describe('group B — delta window', () => {
    it('test_fetch_uses_3_day_window_when_hasStoredTokens_true', async () => {
      vi.mocked(hasStoredTokens).mockResolvedValue(true)
      const { result } = renderHook(() => useSafewaySync(userId))

      await act(async () => {
        await result.current.checkStoredTokens()
      })

      await act(async () => {
        await result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.SUCCESS)
      })

      expect(mockFetchSafewayReceipts).toHaveBeenCalledWith(
        expect.objectContaining({ daysOverride: 3 })
      )
    })

    it('test_fetch_uses_90_day_window_when_hasStoredTokens_false', async () => {
      const { result } = renderHook(() => useSafewaySync(userId))

      await act(async () => {
        await result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.SUCCESS)
      })

      expect(mockFetchSafewayReceipts).toHaveBeenCalledWith(
        expect.objectContaining({ daysOverride: 90 })
      )
    })
  })

  describe('group C — knownOrderIds pre-fetch', () => {
    it('test_known_order_ids_forwarded_to_fetcher_when_api_getReceipts_succeeds', async () => {
      vi.mocked(api.getReceipts).mockResolvedValue({
        receipts: [
          { provider: 'safeway', order_id: 'sw-1' },
          { provider: 'costco', order_id: 'co-9' },
          { provider: 'safeway', order_id: 'sw-2' },
        ],
      })

      const { result } = renderHook(() => useSafewaySync(userId))

      await act(async () => {
        await result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.SUCCESS)
      })

      expect(mockFetchSafewayReceipts).toHaveBeenCalledWith(
        expect.objectContaining({
          knownOrderIds: expect.arrayContaining(['sw-1', 'sw-2']),
        })
      )
      const call = mockFetchSafewayReceipts.mock.calls[0][0]
      expect(call.knownOrderIds).toEqual(['sw-1', 'sw-2'])
    })

    it('test_known_order_ids_empty_when_api_getReceipts_throws_silently', async () => {
      vi.mocked(api.getReceipts).mockRejectedValue(new Error('network down'))

      const { result } = renderHook(() => useSafewaySync(userId))

      await act(async () => {
        await result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.SUCCESS)
      })

      expect(mockFetchSafewayReceipts).toHaveBeenCalledWith(
        expect.objectContaining({ knownOrderIds: [] })
      )
    })
  })

  describe('group D — progress events', () => {
    it('test_webview_progress_event_updates_progress_state', async () => {
      const { result } = renderHook(() => useSafewaySync(userId))

      await act(async () => {
        window.dispatchEvent(
          new CustomEvent('webview-progress', {
            detail: { step: 'page-load', current: 2, total: 7 },
          })
        )
      })

      expect(result.current.progress).toEqual({
        step: 'page-load',
        current: 2,
        total: 7,
      })
    })

    it('test_progress_listener_removed_on_unmount', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener')
      const { unmount } = renderHook(() => useSafewaySync(userId))

      unmount()

      expect(removeSpy).toHaveBeenCalledWith('webview-progress', expect.any(Function))
      removeSpy.mockRestore()
    })
  })

  describe('group E — auth error branches', () => {
    it('test_431_from_fetcher_surfaces_error_and_does_not_clear_tokens', async () => {
      const err431 = new Error('Safeway list API failed (431)');
      err431.status = 431;
      mockFetchSafewayReceipts.mockRejectedValue(err431);

      const { result } = renderHook(() => useSafewaySync(userId));

      await act(async () => {
        await result.current.startSync();
      });

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.ERROR);
      });

      expect(result.current.error).toMatch(/431/);
      expect(vi.mocked(clearStoredTokens)).not.toHaveBeenCalled();
    });

    it('test_401_clears_tokens', async () => {
      mockStartLogin.mockRejectedValue(new Error('Upstream returned 401 Unauthorized'))

      const { result } = renderHook(() => useSafewaySync(userId))

      await act(async () => {
        await result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.ERROR)
      })

      expect(vi.mocked(clearStoredTokens)).toHaveBeenCalled()
    })

    it('test_403_clears_tokens', async () => {
      mockStartLogin.mockRejectedValue(new Error('Forbidden 403'))

      const { result } = renderHook(() => useSafewaySync(userId))

      await act(async () => {
        await result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.ERROR)
      })

      expect(vi.mocked(clearStoredTokens)).toHaveBeenCalled()
    })

    it('test_session_expired_message_clears_tokens', async () => {
      mockStartLogin.mockRejectedValue(
        new Error('Your session expired. Please sign in again.')
      )

      const { result } = renderHook(() => useSafewaySync(userId))

      await act(async () => {
        await result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.ERROR)
      })

      expect(vi.mocked(clearStoredTokens)).toHaveBeenCalled()
    })
  })

  describe('group F — silent path', () => {
    it('test_startSilent_null_result_sets_session_expired_error', async () => {
      vi.mocked(startSilentSync).mockResolvedValue(null)

      const { result } = renderHook(() => useSafewaySync(userId))

      await act(async () => {
        await result.current.startSilent()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.ERROR)
      })

      expect(result.current.error).toBe('Safeway session expired. Please sign in again.')
      expect(vi.mocked(clearStoredTokens)).toHaveBeenCalled()
    })

    it('test_startSilent_empty_receipts_sets_success_with_zero_counts', async () => {
      vi.mocked(startSilentSync).mockResolvedValue({
        accessToken: 'silent-tok',
        clubCard: '999',
      })
      mockFetchSafewayReceipts.mockResolvedValue([])

      const { result } = renderHook(() => useSafewaySync(userId))

      await act(async () => {
        await result.current.startSilent()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.SUCCESS)
      })

      expect(mockIngestReceipts).not.toHaveBeenCalled()
      expect(result.current.result).toEqual({
        receipts: [],
        count: 0,
        receipts_stored: 0,
        items_added_to_pantry: 0,
        errors: [],
      })
    })
  })

  describe('group G — background trigger', () => {
    it('test_triggerGeneration_fires_only_when_itemsAdded_gt_3', async () => {
      mockIngestReceipts.mockResolvedValueOnce({
        receipts_stored: 1,
        items_added_to_pantry: 5,
        errors: [],
      })

      const { result } = renderHook(() => useSafewaySync(userId))

      await act(async () => {
        await result.current.startSync()
      })

      await waitFor(() => {
        expect(result.current.status).toBe(STATUS.SUCCESS)
      })

      expect(mockTriggerGeneration).toHaveBeenCalledWith(userId, {
        triggerReason: 'receipt_scan',
      })

      mockTriggerGeneration.mockClear()
      mockIngestReceipts.mockResolvedValue({
        receipts_stored: 1,
        items_added_to_pantry: 3,
        errors: [],
      })

      const { result: r2 } = renderHook(() => useSafewaySync(userId))

      await act(async () => {
        await r2.current.startSync()
      })

      await waitFor(() => {
        expect(r2.current.status).toBe(STATUS.SUCCESS)
      })

      expect(mockTriggerGeneration).not.toHaveBeenCalled()
    })
  })
})

describe('useSafewaySync receipt_scan pool trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isNativePlatformMock.mockReturnValue(true)
    vi.mocked(hasStoredTokens).mockResolvedValue(false)
    vi.mocked(clearStoredTokens).mockResolvedValue(undefined)
    mockStartLogin.mockResolvedValue({
      accessToken: 'tok',
      clubCard: '12345',
    })
    mockFetchSafewayReceipts.mockResolvedValue([{ order_id: 'o1' }])
  })

  it('calls triggerGeneration when items_added_to_pantry is greater than 3', async () => {
    mockIngestReceipts.mockResolvedValue({
      receipts_stored: 1,
      items_added_to_pantry: 5,
      errors: [],
    })

    const { result } = renderHook(() => useSafewaySync(userId))

    await act(async () => {
      result.current.startSync()
    })

    await waitFor(() => {
      expect(result.current.status).toBe('success')
    })

    expect(mockTriggerGeneration).toHaveBeenCalledWith(userId, {
      triggerReason: 'receipt_scan',
    })
  })

  it('does not call triggerGeneration when exactly 3 items added', async () => {
    mockIngestReceipts.mockResolvedValue({
      receipts_stored: 1,
      items_added_to_pantry: 3,
      errors: [],
    })

    const { result } = renderHook(() => useSafewaySync(userId))

    await act(async () => {
      result.current.startSync()
    })

    await waitFor(() => {
      expect(result.current.status).toBe('success')
    })

    expect(mockTriggerGeneration).not.toHaveBeenCalled()
  })
})
