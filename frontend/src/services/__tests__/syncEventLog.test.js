/**
 * syncEventLog unit tests (localStorage mocked; no Capacitor Preferences).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const captureHandledError = vi.fn()
const addBreadcrumb = vi.fn()
const setMonitoringTag = vi.fn()
const recordMock = vi.fn(() => Promise.resolve())

vi.mock('../monitoring.js', () => ({
  captureHandledError,
  addBreadcrumb,
  setMonitoringTag,
}))

vi.mock('../syncTelemetry.js', () => ({
  record: (...args) => recordMock(...args),
}))

vi.mock('../supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null } })),
    },
  },
}))

vi.mock('../apiClient.js', () => ({
  initApiBaseUrl: vi.fn(() => Promise.resolve()),
  getEffectiveApiBaseUrl: vi.fn(() => ({ url: 'http://localhost:5000/api' })),
}))

describe('syncEventLog', () => {
  const lsStore = {}

  beforeEach(async () => {
    vi.clearAllMocks()
    Object.keys(lsStore).forEach((k) => delete lsStore[k])
    vi.stubGlobal('localStorage', {
      getItem: (k) => (k in lsStore ? lsStore[k] : null),
      setItem: (k, v) => {
        lsStore[k] = String(v)
      },
      removeItem: (k) => {
        delete lsStore[k]
      },
      clear: () => {
        Object.keys(lsStore).forEach((k) => delete lsStore[k])
      },
    })
    vi.resetModules()
    captureHandledError.mockReturnValue('event-id')
  })

  it('queues phases and never throws without DSN', async () => {
    const { logPhase, dump } = await import('../syncEventLog.js')
    await logPhase('costco', 'webview_opened', { mode: 'login' })
    const queued = await dump()
    expect(queued.length).toBe(1)
    expect(queued[0].phase).toBe('webview_opened')
    expect(queued[0].provider).toBe('costco')
    expect(addBreadcrumb).toHaveBeenCalled()
  })

  it('dedupes GlitchTip anomalies per provider+phase within cooldown', async () => {
    const { reportAnomaly } = await import('../syncEventLog.js')
    await reportAnomaly('costco', 'close_unconfirmed', { mode: 'login', reason: 'a' })
    await reportAnomaly('costco', 'close_unconfirmed', { mode: 'login', reason: 'b' })
    expect(captureHandledError).toHaveBeenCalledTimes(1)
  })

  it('beginSyncAttempt sets sync id and logs session_begin', async () => {
    const { beginSyncAttempt, getActiveSyncId, logPhase, dump } = await import('../syncEventLog.js')
    const syncId = beginSyncAttempt('safeway', 'silent')
    await logPhase('safeway', 'session_begin', { syncId, mode: 'silent' })
    expect(syncId).toBeTruthy()
    expect(getActiveSyncId('safeway')).toBe(syncId)
    expect(setMonitoringTag).toHaveBeenCalledWith('sync_id', syncId)
    const queued = await dump()
    expect(queued.some((e) => e.phase === 'session_begin')).toBe(true)
  })

  it('escalates sync_skipped to anomaly after three consecutive skips', async () => {
    const { logPhase } = await import('../syncEventLog.js')
    await logPhase('costco', 'sync_skipped', { mode: 'silent', reason: 'webview_busy' })
    await logPhase('costco', 'sync_skipped', { mode: 'silent', reason: 'webview_busy' })
    expect(captureHandledError).not.toHaveBeenCalled()
    await logPhase('costco', 'sync_skipped', { mode: 'silent', reason: 'webview_busy' })
    expect(captureHandledError).toHaveBeenCalledTimes(1)
  })

  it('mirrors session_begin and sync_succeeded into syncTelemetry', async () => {
    const { beginSyncAttempt, logPhase } = await import('../syncEventLog.js')
    beginSyncAttempt('costco', 'login')
    await logPhase('costco', 'sync_succeeded', { mode: 'login' })
    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'costco', outcome: 'attempt', tier: 't2' })
    )
    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'costco', outcome: 'success', tier: 't2' })
    )
  })

  it('does not copy mode/reason into metadata and caps at 10 keys', async () => {
    const { logPhase, dump } = await import('../syncEventLog.js')
    const extra = {}
    for (let i = 0; i < 12; i++) extra[`k${i}`] = i
    await logPhase('costco', 'needs_reconnect', {
      mode: 'silent',
      reason: 'refresh_invalid_grant',
      ...extra,
    })
    const queued = await dump()
    expect(queued[0].mode).toBe('silent')
    expect(queued[0].reason).toBe('refresh_invalid_grant')
    expect(queued[0].metadata.mode).toBeUndefined()
    expect(queued[0].metadata.reason).toBeUndefined()
    expect(Object.keys(queued[0].metadata).length).toBeLessThanOrEqual(10)
  })
})
