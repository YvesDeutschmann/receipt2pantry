import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFlags, trace, redact } from '../syncDebugFlags.js'

describe('syncDebugFlags', () => {
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
      key: (i) => [...lsStore.keys()][i] ?? null,
      get length() {
        return lsStore.size
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('READ_FLAGS_ALL_OFF_WHEN_LOCALSTORAGE_EMPTY', () => {
    expect(readFlags()).toEqual({
      tierTrace: false,
      telemetryDevPanel: false,
      autoEnabled: false,
      minResyncMsOverride: null,
    })
  })

  it('READ_FLAGS_TIER_TRACE_ON_WHEN_VALUE_IS_1', () => {
    localStorage.setItem('SYNC_TIER_TRACE', '1')
    expect(readFlags().tierTrace).toBe(true)
  })

  it('READ_FLAGS_TIER_TRACE_OFF_FOR_OTHER_VALUES', () => {
    for (const v of ['0', 'true', '']) {
      lsStore.clear()
      localStorage.setItem('SYNC_TIER_TRACE', v)
      expect(readFlags().tierTrace).toBe(false)
    }
  })

  it('READ_FLAGS_MIN_RESYNC_MS_PARSED_AS_INT', () => {
    localStorage.setItem('SYNC_MIN_RESYNC_MS_OVERRIDE', '60000')
    expect(readFlags().minResyncMsOverride).toBe(60000)
    localStorage.setItem('SYNC_MIN_RESYNC_MS_OVERRIDE', 'abc')
    expect(readFlags().minResyncMsOverride).toBe(null)
  })

  it('TRACE_NOOP_WHEN_FLAG_OFF', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    trace('t.example', {
      get boom() {
        throw new Error('should not read data when flag off')
      },
    })
    expect(log).not.toHaveBeenCalled()
  })

  it('TRACE_LOGS_WHEN_FLAG_ON', () => {
    localStorage.setItem('SYNC_TIER_TRACE', '1')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const data = { a: 1 }
    trace('t2.safeway.cookieRead', data)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toBe('[SyncTrace][t2.safeway.cookieRead]')
    expect(log.mock.calls[0][1]).toBe(data)
  })

  it('REDACT_LONG_STRING', () => {
    expect(redact('supersecretvalue')).toBe('<length=16, head=supers>')
  })

  it('REDACT_SHORT_STRING', () => {
    expect(redact('abc')).toBe('<length=3>')
  })

  it('REDACT_EMPTY_OR_NULL', () => {
    expect(redact('')).toBe('<empty>')
    expect(redact(null)).toBe('<empty>')
    expect(redact(undefined)).toBe('<empty>')
  })

  it('REDACT_NUMBER_OR_BOOL', () => {
    expect(redact(42)).toBe(42)
    expect(redact(false)).toBe(false)
  })
})
