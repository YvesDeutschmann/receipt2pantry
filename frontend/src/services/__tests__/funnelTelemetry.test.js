import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { telemStore } = vi.hoisted(() => ({ telemStore: new Map() }))

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

const STORAGE_KEY = 'funnel_telemetry'

async function loadModule() {
  return import('../funnelTelemetry.js')
}

describe('funnelTelemetry', () => {
  let emit
  let dump
  let reset
  let getSessionId
  let FunnelEvent
  /** @type {Map<string, string>} */
  let lsStore

  beforeEach(async () => {
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
      key: (i) => [...lsStore.keys()][i] ?? null,
      get length() {
        return lsStore.size
      },
    })
    vi.resetModules()
    telemStore.clear()
    delete window.__funnelTelemetry
    ;({ emit, dump, reset, getSessionId, FunnelEvent } = await loadModule())
  })

  afterEach(() => {
    telemStore.clear()
    lsStore?.clear()
    delete window.__funnelTelemetry
    vi.unstubAllGlobals()
  })

  it('EMIT_RECORDS_EVENT_IN_STORAGE', async () => {
    await emit(FunnelEvent.SIGN_IN, 'user-uuid-1', {}, { now: 1000 })
    const events = await dump()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      event: 'funnel_sign_in',
      userId: 'user-uuid-1',
      timestamp: 1000,
    })
    expect(events[0].sessionId).toBeTypeOf('string')
    expect(events[0].sessionId.length).toBeGreaterThan(0)
  })

  it('EMIT_IDEMPOTENT_SAME_EVENT_SAME_USER', async () => {
    await emit(FunnelEvent.SIGN_IN, 'user-uuid-1', {}, { now: 1000 })
    await emit(FunnelEvent.SIGN_IN, 'user-uuid-1', {}, { now: 2000 })
    const events = await dump()
    expect(events).toHaveLength(1)
    expect(events[0].timestamp).toBe(1000)
  })

  it('EMIT_NOT_IDEMPOTENT_DIFFERENT_EVENTS', async () => {
    await emit(FunnelEvent.SIGN_IN, 'user-uuid-1', {}, { now: 1000 })
    await emit(FunnelEvent.STORE_CONNECTED, 'user-uuid-1', {}, { now: 2000 })
    const events = await dump()
    expect(events).toHaveLength(2)
    expect(events.map((e) => e.event)).toEqual([
      'funnel_sign_in',
      'funnel_store_connected',
    ])
  })

  it('EMIT_NOT_IDEMPOTENT_DIFFERENT_USERS', async () => {
    await emit(FunnelEvent.SIGN_IN, 'user-uuid-1', {}, { now: 1000 })
    await emit(FunnelEvent.SIGN_IN, 'user-uuid-2', {}, { now: 2000 })
    const events = await dump()
    expect(events).toHaveLength(2)
    expect(events.map((e) => e.userId)).toEqual(['user-uuid-1', 'user-uuid-2'])
  })

  it('EMIT_NOOP_WHEN_USER_ID_EMPTY', async () => {
    await emit(FunnelEvent.SIGN_IN, '')
    await emit(FunnelEvent.SIGN_IN, null)
    await emit(FunnelEvent.SIGN_IN, undefined)
    const events = await dump()
    expect(events).toEqual([])
  })

  it('EMIT_SURVIVES_CORRUPT_STORAGE', async () => {
    telemStore.set(STORAGE_KEY, 'not-json{')
    await emit(FunnelEvent.SIGN_IN, 'user-uuid-1', {}, { now: 1000 })
    const events = await dump()
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events.some((e) => e.event === 'funnel_sign_in')).toBe(true)
  })

  it('EMIT_CAPS_AT_200', async () => {
    for (let i = 0; i < 201; i++) {
      await emit(FunnelEvent.SIGN_IN, `user-${i}`, {}, { now: i })
    }
    const events = await dump()
    expect(events).toHaveLength(200)
    expect(events[0].userId).toBe('user-1')
    expect(events[199].userId).toBe('user-200')
  })

  it('EMIT_USES_NOW_OVERRIDE', async () => {
    await emit(FunnelEvent.SIGN_IN, 'user-uuid-1', {}, { now: 42000 })
    const events = await dump()
    expect(events[0].timestamp).toBe(42000)
  })

  it('EMIT_USES_DATE_NOW_BY_DEFAULT', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(99999)
    await emit(FunnelEvent.SIGN_IN, 'user-uuid-1')
    nowSpy.mockRestore()
    const events = await dump()
    expect(events[0].timestamp).toBe(99999)
  })

  it('GET_SESSION_ID_RETURNS_CONSISTENT_VALUE', () => {
    const a = getSessionId()
    const b = getSessionId()
    expect(a).toBe(b)
    expect(a).toBeTypeOf('string')
    expect(a.length).toBeGreaterThan(0)
  })

  it('EMIT_DROPS_OBJECT_METADATA_VALUES', async () => {
    await emit(
      FunnelEvent.STAPLES_CONFIRMED,
      'user-uuid-1',
      { count: 3, label: 'ok', nested: { x: 1 } },
      { now: 1000 }
    )
    const events = await dump()
    expect(events[0].metadata).toEqual({ count: 3, label: 'ok' })
    expect(events[0].metadata.nested).toBeUndefined()
  })

  it('EMIT_STORES_PRIMITIVE_METADATA', async () => {
    await emit(
      FunnelEvent.STAPLES_CONFIRMED,
      'user-uuid-1',
      { staplesCount: 12 },
      { now: 1000 }
    )
    const events = await dump()
    expect(events[0].metadata.staplesCount).toBe(12)
  })

  it('RESET_CLEARS_ALL_EVENTS', async () => {
    await emit(FunnelEvent.SIGN_IN, 'user-uuid-1', {}, { now: 1000 })
    await emit(FunnelEvent.STORE_CONNECTED, 'user-uuid-1', {}, { now: 2000 })
    await reset()
    const events = await dump()
    expect(events).toEqual([])
  })

  it('DEV_PANEL_NOT_EXPOSED_BY_DEFAULT', async () => {
    expect(window.__funnelTelemetry).toBeUndefined()
  })

  it('DEV_PANEL_EXPOSED_WHEN_FLAG_SET', async () => {
    lsStore.set('FUNNEL_TELEMETRY_DEV_PANEL', '1')
    vi.resetModules()
    telemStore.clear()
    delete window.__funnelTelemetry
    const mod = await loadModule()
    expect(window.__funnelTelemetry).toBeDefined()
    expect(typeof window.__funnelTelemetry.dump).toBe('function')
    expect(typeof window.__funnelTelemetry.reset).toBe('function')
    expect(typeof window.__funnelTelemetry.getSessionId).toBe('function')
    expect(mod.getSessionId()).toBe(window.__funnelTelemetry.getSessionId())
  })

  it('EMIT_REPEATABLE_RECORDS_EACH_CALL', async () => {
    vi.resetModules()
    telemStore.clear()
    const { emitRepeatable, dump, FunnelEvent } = await loadModule()
    await emitRepeatable(FunnelEvent.COOK_LOGGED, 'user-uuid-1', { recipeId: '1' }, { now: 1000 })
    await emitRepeatable(FunnelEvent.COOK_LOGGED, 'user-uuid-1', { recipeId: '2' }, { now: 2000 })
    const events = await dump()
    const cooks = events.filter((e) => e.event === 'cook_logged')
    expect(cooks).toHaveLength(2)
    expect(cooks[0].repeatable).toBe(true)
    expect(cooks[1].repeatable).toBe(true)
    expect(cooks[0].entryId).toBeTypeOf('string')
    expect(cooks[0].entryId).not.toBe(cooks[1].entryId)
    expect(cooks[0].metadata).toEqual({ recipeId: '1' })
  })

  it('EMIT_REPEATABLE_NOOP_WHEN_USER_ID_EMPTY', async () => {
    vi.resetModules()
    telemStore.clear()
    const { emitRepeatable, dump, FunnelEvent } = await loadModule()
    await emitRepeatable(FunnelEvent.RECIPE_DETAIL_OPENED, '')
    await emitRepeatable(FunnelEvent.RECIPE_DETAIL_OPENED, null)
    const events = await dump()
    expect(events).toEqual([])
  })

  it('FLUSH_SKIPS_WITHOUT_SESSION', async () => {
    vi.doMock('../supabaseClient.js', () => ({
      supabase: {
        auth: {
          getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
        },
      },
    }))
    vi.resetModules()
    const { emit, flush, FunnelEvent } = await import('../funnelTelemetry.js')
    await emit(FunnelEvent.SIGN_IN, 'user-uuid-1', {}, { now: 1000 })
    const result = await flush()
    expect(result).toEqual({ sent: 0, skipped: 0 })
  })

  it('FLUSH_MARKS_EVENTS_SENT_ON_SUCCESS', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    vi.doMock('../supabaseClient.js', () => ({
      supabase: {
        auth: {
          getSession: vi.fn().mockResolvedValue({
            data: { session: { access_token: 'token-abc' } },
          }),
        },
      },
    }))
    vi.doMock('../apiClient.js', () => ({
      initApiBaseUrl: vi.fn().mockResolvedValue(undefined),
      getEffectiveApiBaseUrl: vi.fn().mockReturnValue({ url: 'http://localhost:5000/api' }),
    }))
    vi.resetModules()
    const { emit, flush, dump, FunnelEvent } = await import('../funnelTelemetry.js')
    await emit(FunnelEvent.SIGN_IN, 'user-uuid-1', {}, { now: 1000 })
    const result = await flush()
    expect(result.sent).toBe(1)
    const events = await dump()
    expect(events[0].sent).toBe(true)
    expect(fetchMock).toHaveBeenCalled()
  })
})
