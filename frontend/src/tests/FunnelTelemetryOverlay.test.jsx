import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { dumpMock, subscribeMock, exportDumpToDevLogMock, enableMock, isEnabled } = vi.hoisted(
  () => {
    const listeners = new Set()
    return {
      dumpMock: vi.fn(async () => []),
      subscribeMock: vi.fn((listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }),
      exportDumpToDevLogMock: vi.fn(() => Promise.resolve()),
      enableMock: vi.fn(),
      isEnabled: { current: false },
      listeners,
    }
  }
)

vi.mock('../services/funnelTelemetry', () => ({
  dump: (...args) => dumpMock(...args),
  subscribe: (listener) => subscribeMock(listener),
  FunnelEvent: {
    SIGN_IN: 'funnel_sign_in',
    RECEIPTS_SYNCED: 'funnel_receipts_synced',
    FIRST_SUGGESTION_VIEWED: 'funnel_first_suggestion_viewed',
  },
}))

vi.mock('../services/funnelTelemetryExport', () => ({
  FUNNEL_TELEMETRY_EXPORT_CHANGED: 'funnel-telemetry-export-changed',
  isFunnelTelemetryExportEnabled: () => isEnabled.current,
  enableFunnelTelemetryExport: (...args) => enableMock(...args),
  exportDumpToDevLog: (...args) => exportDumpToDevLogMock(...args),
  summarizeDump: (events) => {
    const list = Array.isArray(events) ? events : []
    const receipts = list.find((e) => e.event === 'funnel_receipts_synced')
    return {
      count: list.length,
      events: list.map((e) => e.event),
      receiptsSynced: Boolean(receipts),
      matchCount: receipts?.metadata?.matchCount ?? null,
      coldStartDeltaMs: null,
    }
  },
}))

import FunnelTelemetryOverlay from '../components/FunnelTelemetryOverlay'

describe('FunnelTelemetryOverlay', () => {
  beforeEach(() => {
    isEnabled.current = false
    dumpMock.mockReset()
    dumpMock.mockResolvedValue([])
    exportDumpToDevLogMock.mockReset()
    enableMock.mockReset()
    subscribeMock.mockClear()
  })

  afterEach(() => {
    isEnabled.current = false
  })

  it('HIDDEN_WHEN_EXPORT_DISABLED', () => {
    render(<FunnelTelemetryOverlay />)
    expect(screen.queryByTestId('funnel-telemetry-overlay')).not.toBeInTheDocument()
  })

  it('SHOWS_RECEIPTS_PROOF_FROM_DUMP', async () => {
    isEnabled.current = true
    dumpMock.mockResolvedValue([
      {
        event: 'funnel_sign_in',
        userId: 'user-uuid-1',
        timestamp: 1000,
        sessionId: 'sess-1',
        metadata: {},
      },
      {
        event: 'funnel_receipts_synced',
        userId: 'user-uuid-1',
        timestamp: 2000,
        sessionId: 'sess-1',
        metadata: { matchCount: 5 },
      },
    ])
    render(<FunnelTelemetryOverlay />)
    expect(await screen.findByTestId('funnel-telemetry-overlay')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /expand funnel dump/i }))
    expect(await screen.findByText(/matchCount:\s*5/i)).toBeInTheDocument()
    expect(screen.getAllByText(/receipts synced/i).length).toBeGreaterThan(0)
  })

  it('SEND_DUMP_BUTTON_POSTS_TO_DEV_LOG', async () => {
    isEnabled.current = true
    dumpMock.mockResolvedValue([])
    render(<FunnelTelemetryOverlay />)
    await screen.findByTestId('funnel-telemetry-overlay')
    fireEvent.click(screen.getByRole('button', { name: /expand funnel dump/i }))
    fireEvent.click(await screen.findByRole('button', { name: /send dump to backend/i }))
    await waitFor(() => {
      expect(exportDumpToDevLogMock).toHaveBeenCalledWith('manual')
    })
  })
})
