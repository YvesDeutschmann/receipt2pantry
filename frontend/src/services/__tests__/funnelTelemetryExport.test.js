import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { telemStore, postDevLog } = vi.hoisted(() => ({
  telemStore: new Map(),
  postDevLog: vi.fn(),
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(({ key }) =>
      Promise.resolve({ value: telemStore.has(key) ? telemStore.get(key) : null })
    ),
    set: vi.fn(({ key, value }) => {
      telemStore.set(key, value)
      return Promise.resolve()
    }),
    remove: vi.fn(({ key }) => {
      telemStore.delete(key)
      return Promise.resolve()
    }),
  },
}))

vi.mock('../../services/apiClient', () => ({
  postDevLog: (...args) => postDevLog(...args),
}))

async function loadExportModule() {
  return import('../funnelTelemetryExport.js')
}

async function loadTelemetryModule() {
  return import('../funnelTelemetry.js')
}

describe('funnelTelemetryExport', () => {
  /** @type {Map<string, string>} */
  let lsStore

  beforeEach(() => {
    lsStore = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
      setItem: (k, v) => {
        lsStore.set(k, String(v))
      },
      removeItem: (k) => {
        lsStore.delete(k)
      },
      clear: () => lsStore.clear(),
    })
    vi.resetModules()
    telemStore.clear()
    postDevLog.mockReset()
    delete window.__funnelTelemetry
  })

  afterEach(() => {
    telemStore.clear()
    lsStore?.clear()
    delete window.__funnelTelemetry
    vi.unstubAllGlobals()
  })

  it('SUMMARIZE_DUMP_MARKS_RECEIPTS_PROOF', async () => {
    const { summarizeDump } = await loadExportModule()
    const { FunnelEvent } = await loadTelemetryModule()
    const summary = summarizeDump([
      {
        event: FunnelEvent.SIGN_IN,
        userId: 'user-uuid-1',
        timestamp: 1000,
        sessionId: 'sess-1',
        metadata: {},
      },
      {
        event: FunnelEvent.RECEIPTS_SYNCED,
        userId: 'user-uuid-1',
        timestamp: 4000,
        sessionId: 'sess-1',
        metadata: { matchCount: 7 },
      },
      {
        event: FunnelEvent.FIRST_SUGGESTION_VIEWED,
        userId: 'user-uuid-1',
        timestamp: 5000,
        sessionId: 'sess-1',
        metadata: {},
      },
    ])
    expect(summary.receiptsSynced).toBe(true)
    expect(summary.matchCount).toBe(7)
    expect(summary.coldStartDeltaMs).toBe(4000)
    expect(summary.sameSession).toBe(true)
    expect(summary.events).toEqual([
      'funnel_sign_in',
      'funnel_receipts_synced',
      'funnel_first_suggestion_viewed',
    ])
  })

  it('SUMMARIZE_DUMP_EMPTY_HAS_NO_RECEIPTS_PROOF', async () => {
    const { summarizeDump } = await loadExportModule()
    expect(summarizeDump([])).toMatchObject({
      count: 0,
      receiptsSynced: false,
      matchCount: null,
      coldStartDeltaMs: null,
    })
  })

  it('EXPORT_NOOP_WHEN_FLAG_OFF', async () => {
    const { exportDumpToDevLog } = await loadExportModule()
    const { emit, FunnelEvent } = await loadTelemetryModule()
    await emit(FunnelEvent.RECEIPTS_SYNCED, 'user-uuid-1', { matchCount: 2 }, { now: 1000 })
    await exportDumpToDevLog('manual')
    expect(postDevLog).not.toHaveBeenCalled()
  })

  it('EXPORT_POSTS_SUMMARY_AND_DUMP_WHEN_FLAG_ON', async () => {
    lsStore.set('FUNNEL_TELEMETRY_DEV_PANEL', '1')
    const { exportDumpToDevLog } = await loadExportModule()
    const { emit, FunnelEvent } = await loadTelemetryModule()
    await emit(FunnelEvent.RECEIPTS_SYNCED, 'user-uuid-1', { matchCount: 3 }, { now: 1000 })
    await exportDumpToDevLog('manual')
    expect(postDevLog).toHaveBeenCalled()
    const tags = postDevLog.mock.calls.map((c) => c[0])
    expect(tags).toContain('funnelTelemetry')
    expect(tags).toContain('funnelTelemetryDump')
    const summaryBody = postDevLog.mock.calls.find((c) => c[0] === 'funnelTelemetry')[1]
    const summary = JSON.parse(summaryBody)
    expect(summary.reason).toBe('manual')
    expect(summary.summary.receiptsSynced).toBe(true)
    expect(summary.summary.matchCount).toBe(3)
    const dumpBody = postDevLog.mock.calls.find((c) => c[0] === 'funnelTelemetryDump')[1]
    const dumped = JSON.parse(dumpBody)
    expect(dumped[0].event).toBe('funnel_receipts_synced')
    expect(dumped[0].userId).toBe('user-uuid-1')
  })

  it('START_EXPORT_SHIPS_ON_EMIT_WHEN_FLAG_ON', async () => {
    lsStore.set('FUNNEL_TELEMETRY_DEV_PANEL', '1')
    const { startFunnelTelemetryExport } = await loadExportModule()
    const { emit, FunnelEvent } = await loadTelemetryModule()
    startFunnelTelemetryExport()
    await emit(FunnelEvent.STORE_CONNECTED, 'user-uuid-1', {}, { now: 2000 })
    expect(postDevLog).toHaveBeenCalled()
    const summaryBody = postDevLog.mock.calls.find((c) => c[0] === 'funnelTelemetry')[1]
    expect(JSON.parse(summaryBody).reason).toBe('emit')
  })

  it('START_EXPORT_USES_RECEIPTS_REASON_FOR_SYNC_EVENT', async () => {
    lsStore.set('FUNNEL_TELEMETRY_DEV_PANEL', '1')
    const { startFunnelTelemetryExport } = await loadExportModule()
    const { emit, FunnelEvent } = await loadTelemetryModule()
    startFunnelTelemetryExport()
    await emit(FunnelEvent.RECEIPTS_SYNCED, 'user-uuid-1', { matchCount: 4 }, { now: 3000 })
    const summaryBody = postDevLog.mock.calls.find((c) => c[0] === 'funnelTelemetry')[1]
    expect(JSON.parse(summaryBody).reason).toBe('receipts_synced')
  })

  it('ENABLE_SETS_FLAG_AND_EXPOSES_EXPORT_DUMP', async () => {
    const { enableFunnelTelemetryExport, isFunnelTelemetryExportEnabled } =
      await loadExportModule()
    expect(isFunnelTelemetryExportEnabled()).toBe(false)
    enableFunnelTelemetryExport()
    expect(lsStore.get('FUNNEL_TELEMETRY_DEV_PANEL')).toBe('1')
    expect(isFunnelTelemetryExportEnabled()).toBe(true)
    expect(typeof window.__funnelTelemetry.exportDump).toBe('function')
  })
})
