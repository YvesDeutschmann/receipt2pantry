import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { telemStore } = vi.hoisted(() => ({ telemStore: new Map() }))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(({ key }) => Promise.resolve({ value: telemStore.has(key) ? telemStore.get(key) : null })),
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

describe('syncTelemetry', () => {
  let record
  let read
  let reset
  let markCookieStorePersistent
  let markGetCookiesWithoutWebView

  beforeEach(async () => {
    vi.resetModules()
    telemStore.clear()
    ;({
      record,
      read,
      reset,
      markCookieStorePersistent,
      markGetCookiesWithoutWebView,
    } = await import('../syncTelemetry.js'))
  })

  afterEach(() => {
    telemStore.clear()
  })

  it('RECORD_ATTEMPT_INCREMENTS_TIER_ATTEMPTS', async () => {
    await record({ tier: 't2', outcome: 'attempt', provider: 'safeway' })
    const blob = await read('safeway')
    expect(blob.tierAttempts.t2).toBe(1)
    expect(blob.tierSuccesses.t2).toBe(0)
  })

  it('RECORD_SUCCESS_INCREMENTS_TIER_SUCCESSES_AND_UPDATES_LAST_TIER_USED', async () => {
    await record({ tier: 't3', outcome: 'success', provider: 'safeway' })
    const blob = await read('safeway')
    expect(blob.tierSuccesses.t3).toBe(1)
    expect(blob.lastTierUsed).toBe('t3')
    expect(blob.lastSyncAt).toBeTypeOf('number')
  })

  it('RECORD_SUCCESS_APPENDS_DURATION', async () => {
    await record({ tier: 't2', outcome: 'success', provider: 'safeway', durationMs: 100 })
    const blob = await read('safeway')
    expect(blob.tierDurationsMs.t2).toEqual([100])
  })

  it('RECORD_FAIL_INCREMENTS_FAILURE_REASON', async () => {
    await record({ tier: 't2', outcome: 'fail', provider: 'safeway', reason: 'network' })
    const blob = await read('safeway')
    expect(blob.failureReasons.network).toBe(1)
  })

  it('RECORD_FAIL_UNKNOWN_REASON_MAPPED_TO_UNKNOWN', async () => {
    await record({ tier: 't2', outcome: 'fail', provider: 'safeway', reason: 'not_a_real_reason' })
    const blob = await read('safeway')
    expect(blob.failureReasons.unknown).toBe(1)
  })

  it('TIER_DURATIONS_ROLLS_AT_20', async () => {
    for (let i = 0; i < 25; i++) {
      await record({ tier: 't3', outcome: 'success', provider: 'safeway', durationMs: i })
    }
    const blob = await read('safeway')
    expect(blob.tierDurationsMs.t3.length).toBe(20)
    expect(blob.tierDurationsMs.t3[0]).toBe(5)
    expect(blob.tierDurationsMs.t3[19]).toBe(24)
  })

  it('MARK_COOKIE_STORE_PERSISTENT_PERSISTS_VALUE', async () => {
    await markCookieStorePersistent('safeway', true)
    expect((await read('safeway')).cookieStorePersistent).toBe(true)
    await markCookieStorePersistent('safeway', false)
    expect((await read('safeway')).cookieStorePersistent).toBe(false)
  })

  it('MARK_GET_COOKIES_WITHOUT_WEBVIEW_PERSISTS_VALUE', async () => {
    await markGetCookiesWithoutWebView('safeway', true)
    expect((await read('safeway')).getCookiesWithoutWebViewWorks).toBe(true)
  })

  it('READ_RETURNS_DEFAULT_BLOB_WHEN_UNSET', async () => {
    const blob = await read('costco')
    expect(blob.tierAttempts).toEqual({ t1: 0, t2: 0, t3: 0, t4: 0 })
    expect(blob.lastSyncAt).toBe(null)
  })

  it('READ_TOLERATES_MALFORMED_STORED_BLOB', async () => {
    telemStore.set('sync_telemetry_safeway', 'not-json{')
    await expect(read('safeway')).resolves.toMatchObject({
      tierAttempts: { t1: 0, t2: 0, t3: 0, t4: 0 },
    })
  })

  it('RESET_CLEARS_BLOB', async () => {
    await record({ tier: 't1', outcome: 'attempt', provider: 'safeway' })
    await reset('safeway')
    const blob = await read('safeway')
    expect(blob.tierAttempts.t1).toBe(0)
  })

  it('PROVIDER_ISOLATION', async () => {
    await record({ tier: 't2', outcome: 'success', provider: 'safeway' })
    const costco = await read('costco')
    expect(costco.tierSuccesses.t2).toBe(0)
  })
})
