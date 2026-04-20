/**
 * Contract tests for WebView bridges (schema + lifecycle); no real WebView or retailer DOM.
 * @see docs/implementation_briefs/test_coverage/tier_3_frontend/t3-08-webViewBridge.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/** Easily grepable fake secrets — must never appear in console.log args */
const FAKE_ACCESS_TOKEN_ABC123 = 'FAKE_ACCESS_TOKEN_ABC123'
const FAKE_ID_TOKEN_XYZ789 = 'FAKE_ID_TOKEN_XYZ789'

const { ibState, InAppBrowser } = vi.hoisted(() => {
  const state = {
    messageListeners: [],
    closeListeners: [],
    urlListeners: [],
  }
  const removeFrom = (arr, cb) => {
    const i = arr.indexOf(cb)
    if (i >= 0) arr.splice(i, 1)
  }
  const InAppBrowser = {
    addListener: vi.fn(async (event, cb) => {
      if (event === 'messageFromWebview') state.messageListeners.push(cb)
      else if (event === 'closeEvent') state.closeListeners.push(cb)
      else if (event === 'urlChangeEvent') state.urlListeners.push(cb)
      return {
        remove: vi.fn(() => {
          if (event === 'messageFromWebview') removeFrom(state.messageListeners, cb)
          else if (event === 'closeEvent') removeFrom(state.closeListeners, cb)
          else if (event === 'urlChangeEvent') removeFrom(state.urlListeners, cb)
        }),
      }
    }),
    openWebView: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    executeScript: vi.fn(() => Promise.resolve()),
    getCookies: vi.fn(() => Promise.resolve({})),
  }
  return { ibState: state, InAppBrowser }
})

vi.mock('@capgo/inappbrowser', () => ({
  InAppBrowser,
  ToolBarType: { NAVIGATION: 'NAVIGATION' },
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'ios',
    isNativePlatform: () => true,
  },
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(() => Promise.resolve({ value: null })),
    set: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
  },
}))

vi.mock('capacitor-secure-storage-plugin', () => ({
  SecureStoragePlugin: {
    set: vi.fn(() => Promise.resolve()),
    get: vi.fn(() => Promise.resolve({ value: null })),
    remove: vi.fn(() => Promise.resolve()),
  },
}))

/** costcoNativeSync → apiClient pulls supabase; stub api so Costco bridge can load */
vi.mock('../services/apiClient.js', () => ({
  api: {
    storeCostcoReceipts: vi.fn(),
  },
}))

function fireMessage(detail) {
  for (const cb of [...ibState.messageListeners]) {
    cb({ detail })
  }
}

function fireClose() {
  for (const cb of [...ibState.closeListeners]) {
    cb()
  }
}

function fireUrlChange(url) {
  for (const cb of [...ibState.urlListeners]) {
    cb({ url })
  }
}

async function flushUntilListenersReady() {
  await vi.waitFor(() => {
    expect(ibState.messageListeners.length).toBeGreaterThan(0)
  })
}

function stringifyLogArgs(args) {
  return args.map((a) => {
    try {
      if (typeof a === 'string') return a
      return JSON.stringify(a)
    } catch {
      return String(a)
    }
  }).join(' ')
}

function assertNoRawTokensInConsoleLog(logSpy, forbidden) {
  for (const call of logSpy.mock.calls) {
    const joined = stringifyLogArgs(call)
    for (const needle of forbidden) {
      expect(joined).not.toContain(needle)
    }
  }
}

describe('webViewBridge contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ibState.messageListeners = []
    ibState.closeListeners = []
    ibState.urlListeners = []
    InAppBrowser.getCookies.mockResolvedValue({})
    vi.useFakeTimers({ shouldAdvanceTime: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('group A — Costco bridge message shape', () => {
    it('test_costco_startLogin_returns_object_with_required_token_keys', async () => {
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      fireMessage({
        type: 'costco-tokens',
        idToken: FAKE_ID_TOKEN_XYZ789,
        accessToken: FAKE_ACCESS_TOKEN_ABC123,
        clientID: 'cid',
        wcsClientId: 'wcs',
        refreshToken: 'rt',
        refreshTokenClientId: 'rtc',
        userAgent: 'ua',
      })
      const result = await p
      expect(result).toMatchObject({
        idToken: FAKE_ID_TOKEN_XYZ789,
        accessToken: FAKE_ACCESS_TOKEN_ABC123,
        clientID: 'cid',
        wcsClientId: 'wcs',
        refreshToken: 'rt',
        refreshTokenClientId: 'rtc',
        userAgent: 'ua',
        _closeWebViewAfterFetch: true,
      })
    })

    it('test_costco_in_webview_fetch_result_has_fromWebView_flag_set', async () => {
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      fireMessage({
        type: 'costco-receipts',
        receipts: [],
        idToken: FAKE_ID_TOKEN_XYZ789,
        accessToken: FAKE_ACCESS_TOKEN_ABC123,
        clientID: 'cid',
        wcsClientId: 'wcs',
        refreshToken: 'rt',
        refreshTokenClientId: 'rtc',
        userAgent: 'ua',
      })
      const result = await p
      expect(result._fromWebView).toBe(true)
      expect(result.receipts).toEqual([])
    })

    it('test_costco_close_after_fetch_flag_set_when_user_never_navigated_to_orders', async () => {
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      fireMessage({
        type: 'costco-tokens',
        idToken: FAKE_ID_TOKEN_XYZ789,
        accessToken: FAKE_ACCESS_TOKEN_ABC123,
        clientID: 'c1',
        wcsClientId: 'w1',
        refreshToken: 'r1',
        refreshTokenClientId: 'rc1',
        userAgent: 'ua',
      })
      const result = await p
      expect(result._closeWebViewAfterFetch).toBe(true)
      expect(result._fromWebView).toBeUndefined()
    })
  })

  describe('group B — Safeway bridge message shape', () => {
    it('test_safeway_startLogin_returns_accessToken_clubCard_cookieHeader', async () => {
      InAppBrowser.getCookies.mockResolvedValue({
        SWY_ALLOWED: 'cookieval',
      })
      const { startLogin } = await import('../services/safewayWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      fireUrlChange('https://www.safeway.com/')
      fireMessage({
        type: 'safeway-tokens',
        accessToken: FAKE_ACCESS_TOKEN_ABC123,
        clubCard: '1234567890',
      })
      const result = await p
      expect(result.accessToken).toBe(FAKE_ACCESS_TOKEN_ABC123)
      expect(result.clubCard).toBe('1234567890')
      expect(result.cookieHeader).toContain('SWY_ALLOWED=cookieval')
      expect(result._closeWebViewAfterFetch).toBe(true)
    })

    it('test_safeway_missing_clubCard_still_resolves_tokens_with_undefined_clubCard_field', async () => {
      InAppBrowser.getCookies.mockResolvedValueOnce({})
      const { startLogin } = await import('../services/safewayWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      fireMessage({
        type: 'safeway-tokens',
        accessToken: FAKE_ACCESS_TOKEN_ABC123,
      })
      const result = await p
      expect(result.accessToken).toBe(FAKE_ACCESS_TOKEN_ABC123)
      expect(result.clubCard).toBeUndefined()
    })
  })

  describe('group C — progress events', () => {
    it('test_safeway_progress_event_detail_has_step_current_total', async () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      const { startLogin } = await import('../services/safewayWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      fireMessage({
        type: 'safeway-progress',
        step: 'scan',
        current: 2,
        total: 5,
      })
      fireMessage({
        type: 'safeway-tokens',
        accessToken: FAKE_ACCESS_TOKEN_ABC123,
        clubCard: '1111111',
      })
      await p
      const progressEvents = dispatchSpy.mock.calls
        .map((c) => c[0])
        .filter((e) => e?.type === 'webview-progress')
      expect(progressEvents.length).toBeGreaterThan(0)
      for (const ev of progressEvents) {
        expect(ev.detail).toMatchObject({
          step: expect.anything(),
          current: expect.anything(),
          total: expect.anything(),
        })
      }
      dispatchSpy.mockRestore()
    })

    it('test_safeway_progress_events_fire_only_between_start_and_end', async () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      const { startLogin } = await import('../services/safewayWebViewBridge.js')
      InAppBrowser.getCookies.mockResolvedValue({})

      const p = startLogin()
      await flushUntilListenersReady()

      fireMessage({
        type: 'safeway-progress',
        step: 'during',
        current: 1,
        total: 3,
      })
      fireMessage({
        type: 'safeway-tokens',
        accessToken: FAKE_ACCESS_TOKEN_ABC123,
        clubCard: '9999999',
      })

      await p

      const countDuring = dispatchSpy.mock.calls.filter(
        (c) => c[0]?.type === 'webview-progress'
      ).length
      expect(countDuring).toBeGreaterThan(0)

      dispatchSpy.mockClear()
      fireMessage({
        type: 'safeway-progress',
        step: 'after',
        current: 9,
        total: 9,
      })
      const afterProgress = dispatchSpy.mock.calls.filter(
        (c) => c[0]?.type === 'webview-progress'
      )
      expect(afterProgress).toHaveLength(0)

      dispatchSpy.mockRestore()
    })
  })

  describe('group D — cancel / cleanup', () => {
    it('test_startLogin_rejects_when_webview_is_cancelled_by_user', async () => {
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      fireClose()
      await expect(p).rejects.toThrow(/WebView closed before tokens were extracted/)
    })

    it('test_no_pending_promise_leak_after_cancel', async () => {
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      fireClose()
      await expect(p).rejects.toThrow(/WebView closed before tokens were extracted/)

      expect(ibState.messageListeners.length).toBe(0)
      expect(ibState.closeListeners.length).toBe(0)
      expect(ibState.urlListeners.length).toBe(0)

      await vi.advanceTimersByTimeAsync(10_000)
      await Promise.resolve()
    })
  })

  describe('group E — security / logging', () => {
    it('test_bridge_never_logs_raw_access_token', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { startLogin: costcoLogin } = await import('../services/costcoWebViewBridge.js')
      const p1 = costcoLogin()
      await flushUntilListenersReady()
      fireMessage({
        type: 'costco-tokens',
        idToken: FAKE_ID_TOKEN_XYZ789,
        accessToken: FAKE_ACCESS_TOKEN_ABC123,
        clientID: 'c',
        wcsClientId: 'w',
        refreshToken: 'r',
        refreshTokenClientId: 'rc',
        userAgent: 'ua',
      })
      await p1
      assertNoRawTokensInConsoleLog(logSpy, [FAKE_ACCESS_TOKEN_ABC123])
      logSpy.mockRestore()

      vi.clearAllMocks()
      ibState.messageListeners = []
      ibState.closeListeners = []
      ibState.urlListeners = []

      const logSpy2 = vi.spyOn(console, 'log').mockImplementation(() => {})
      InAppBrowser.getCookies.mockResolvedValue({})
      const { startLogin: safewayLogin } = await import('../services/safewayWebViewBridge.js')
      const p2 = safewayLogin()
      await flushUntilListenersReady()
      fireMessage({
        type: 'safeway-tokens',
        accessToken: FAKE_ACCESS_TOKEN_ABC123,
        clubCard: '1',
      })
      await p2
      assertNoRawTokensInConsoleLog(logSpy2, [FAKE_ACCESS_TOKEN_ABC123])
      logSpy2.mockRestore()
    })

    it('test_bridge_never_logs_raw_id_token', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      fireMessage({
        type: 'costco-tokens',
        idToken: FAKE_ID_TOKEN_XYZ789,
        accessToken: FAKE_ACCESS_TOKEN_ABC123,
        clientID: 'c',
        wcsClientId: 'w',
        refreshToken: 'r',
        refreshTokenClientId: 'rc',
        userAgent: 'ua',
      })
      await p
      assertNoRawTokensInConsoleLog(logSpy, [FAKE_ID_TOKEN_XYZ789])
      logSpy.mockRestore()
    })
  })

  describe('group F — smoke', () => {
    it('test_extract_scripts_export_string_functions_that_can_be_stringified', async () => {
      const { getExtractScript: getCostcoScript } = await import(
        '../services/costcoExtractScript.js'
      )
      const { getExtractScript: getSafewayScript } = await import(
        '../services/safewayExtractScript.js'
      )
      const costcoStr = getCostcoScript('https://example.com/graphql')
      const safewayStr = getSafewayScript()
      expect(typeof costcoStr).toBe('string')
      expect(typeof safewayStr).toBe('string')
      expect(JSON.stringify(costcoStr)).toContain('costco')
      expect(JSON.stringify(safewayStr)).toContain('safeway')
      expect(() => new Function(`return ${JSON.stringify(costcoStr)}`)).not.toThrow()
      expect(() => new Function(`return ${JSON.stringify(safewayStr)}`)).not.toThrow()
    })
  })
})
