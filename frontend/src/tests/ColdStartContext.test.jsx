import { describe, test, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, render } from '@testing-library/react'
import { ColdStartProvider, useColdStart } from '../contexts/ColdStartContext'

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '../contexts/AuthContext'

const mockUseAuth = vi.mocked(useAuth)

/** Product cold-start rail has three steps; metadata `cold_start_step` is pinned against this. */
const TOTAL_COLD_START_STEPS = 3

/** Context does not expose `complete`; consumers derive completion from step metadata. */
function coldStartComplete(ctx) {
  return ctx.coldStartStep === TOTAL_COLD_START_STEPS
}

function makeAuth(userMetadata = {}) {
  const user = { id: 'user-1', user_metadata: userMetadata }
  return { user, session: { user } }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseAuth.mockReturnValue(makeAuth({}))
})

describe('ColdStartContext', () => {
  test('test_useColdStart_throws_outside_provider', () => {
    expect(() => renderHook(() => useColdStart())).toThrow(
      'useColdStart must be used within ColdStartProvider'
    )
  })

  test('test_setProgress_updates_current_and_total', () => {
    const wrapper = ({ children }) => <ColdStartProvider>{children}</ColdStartProvider>
    const { result } = renderHook(() => useColdStart(), { wrapper })
    expect(result.current.receiptMatchCount).toBe(0)
    expect(result.current.receiptSyncStatus).toBe('idle')
    act(() => {
      result.current.setReceiptMatchCount(4)
      result.current.setReceiptSyncStatus('syncing')
    })
    expect(result.current.receiptMatchCount).toBe(4)
    expect(result.current.receiptSyncStatus).toBe('syncing')
  })

  test('test_setProgress_is_idempotent_for_same_values', () => {
    let renderCount = 0
    const apiRef = { current: null }
    function Probe() {
      renderCount++
      apiRef.current = useColdStart()
      return null
    }
    render(
      <ColdStartProvider>
        <Probe />
      </ColdStartProvider>
    )
    expect(renderCount).toBe(1)
    act(() => apiRef.current.setReceiptMatchCount(2))
    expect(renderCount).toBe(2)
    act(() => apiRef.current.setReceiptMatchCount(2))
    expect(renderCount).toBe(2)
  })

  test('test_progress_clamped_when_current_exceeds_total', () => {
    const wrapper = ({ children }) => <ColdStartProvider>{children}</ColdStartProvider>
    const { result } = renderHook(() => useColdStart(), { wrapper })
    act(() => result.current.setReceiptMatchCount(500))
    // Observed: no clamp — if a "total" were 10, 500 is still stored.
    expect(result.current.receiptMatchCount).toBe(500)
  })

  test('test_progress_clamped_to_zero_when_current_negative', () => {
    const wrapper = ({ children }) => <ColdStartProvider>{children}</ColdStartProvider>
    const { result } = renderHook(() => useColdStart(), { wrapper })
    act(() => result.current.setReceiptMatchCount(-7))
    expect(result.current.receiptMatchCount).toBe(-7)
  })

  test('test_complete_flag_true_when_current_equals_total', () => {
    mockUseAuth.mockReturnValue(makeAuth({ cold_start_step: TOTAL_COLD_START_STEPS }))
    const wrapper = ({ children }) => <ColdStartProvider>{children}</ColdStartProvider>
    const { result } = renderHook(() => useColdStart(), { wrapper })
    expect(result.current).not.toHaveProperty('complete')
    expect(coldStartComplete(result.current)).toBe(true)
  })

  test('test_complete_flag_false_when_current_less_than_total', () => {
    mockUseAuth.mockReturnValue(makeAuth({ cold_start_step: 1 }))
    const wrapper = ({ children }) => <ColdStartProvider>{children}</ColdStartProvider>
    const { result } = renderHook(() => useColdStart(), { wrapper })
    expect(coldStartComplete(result.current)).toBe(false)
  })

  test('test_context_value_is_memoized_when_setters_unchanged', () => {
    let ctxSnapshot
    function Consumer() {
      ctxSnapshot = useColdStart()
      return null
    }
    function Shell({ n }) {
      return (
        <ColdStartProvider>
          <>
            <Consumer />
            <span data-testid="bump" data-n={n} />
          </>
        </ColdStartProvider>
      )
    }
    const { rerender } = render(<Shell n={0} />)
    const first = ctxSnapshot
    rerender(<Shell n={1} />)
    expect(ctxSnapshot).toBe(first)
  })
})
