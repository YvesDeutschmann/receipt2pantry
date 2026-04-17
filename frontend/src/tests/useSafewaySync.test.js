import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSafewaySync } from '../hooks/useSafewaySync'

const mockStartLogin = vi.fn()
const mockFetchSafewayReceipts = vi.fn()
const mockTriggerGeneration = vi.fn(() => Promise.resolve({ status: 'completed' }))
const mockIngestReceipts = vi.fn()

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'ios',
    isNativePlatform: () => true,
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

describe('useSafewaySync receipt_scan pool trigger', () => {
  const userId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

  beforeEach(() => {
    vi.clearAllMocks()
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
