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
    clearAllCookies: vi.fn(() => Promise.resolve()),
    clearCache: vi.fn(() => Promise.resolve()),
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

  beforeEach(async () => {
    const { forceReleaseWebViewSession } = await import('../services/webViewBridge.js')
    forceReleaseWebViewSession()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('group A — Costco bridge message shape', () => {
    it('test_costco_startLogin_pre_clears_cookies_and_cache', async () => {
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      expect(InAppBrowser.clearAllCookies).toHaveBeenCalledWith({})
      expect(InAppBrowser.clearCache).toHaveBeenCalledWith({})
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
      await p
    })

    it('test_clearCostcoInAppBrowserSession_calls_clearAllCookies_and_clearCache', async () => {
      const { clearCostcoInAppBrowserSession } = await import('../services/costcoWebViewBridge.js')
      await clearCostcoInAppBrowserSession()
      expect(InAppBrowser.close).toHaveBeenCalled()
      expect(InAppBrowser.clearAllCookies).toHaveBeenCalled()
      expect(InAppBrowser.clearCache).toHaveBeenCalled()
    })

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

    it('test_costco_no_akamai_wipe_executeScript_on_www_costco_com', async () => {
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      fireUrlChange('https://www.costco.com/OAuthLogonCmd?x=1')
      await vi.advanceTimersByTimeAsync(3500)
      await Promise.resolve()
      const wipeCalls = InAppBrowser.executeScript.mock.calls.filter((c) =>
        String(c[0]?.code || '').includes('ak_a')
      )
      expect(wipeCalls).toHaveLength(0)
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
      await p
    })

    it('test_costco_skip_injection_on_signin_host_skips_extract_script_after_navigation', async () => {
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      InAppBrowser.executeScript.mockClear()
      fireUrlChange('https://signin.costco.com/authorize')
      await vi.advanceTimersByTimeAsync(3500)
      await Promise.resolve()
      const extractCalls = InAppBrowser.executeScript.mock.calls.filter((c) =>
        String(c[0]?.code || '').includes('findFreshCredential')
      )
      expect(extractCalls).toHaveLength(0)
      const diagCalls = InAppBrowser.executeScript.mock.calls.filter((c) =>
        String(c[0]?.code || '').includes('login-diagnostic')
      )
      expect(diagCalls.length).toBeGreaterThanOrEqual(1)
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
      await p
    })
  })

  describe('group B — Safeway bridge message shape', () => {
    it('test_safeway_startLogin_does_not_pre_clear_cookies_or_cache', async () => {
      const { startLogin } = await import('../services/safewayWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      expect(InAppBrowser.clearAllCookies).not.toHaveBeenCalled()
      expect(InAppBrowser.clearCache).not.toHaveBeenCalled()
      fireMessage({
        type: 'safeway-tokens',
        accessToken: FAKE_ACCESS_TOKEN_ABC123,
      })
      await p
    })

    it('test_safeway_startLogin_returns_accessToken_clubCard_cookieHeader', async () => {
      InAppBrowser.getCookies.mockResolvedValue({
        ACI_S_abs_previouslogin: 'small',
        JSESSIONID: 'cookieval',
        SWY_SHARED_SESSION: '{"accessToken":"ignored-in-header"}',
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
      expect(result.cookieHeader).toContain('JSESSIONID=cookieval')
      expect(result.cookieHeader).not.toContain('SWY_SHARED_SESSION')
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

  describe('group C2 — Costco login loop detection', () => {
    const WCS_ERR_URL =
      'https://signin.costco.com/oauth2/v2.0/logout?wcs-err=true&ClientName=USBC'

    it('test_costco_startLogin_rejects_after_sustained_wcs_err_loop', async () => {
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      for (let i = 0; i < 10; i++) {
        fireUrlChange(`${WCS_ERR_URL}&n=${i}`)
      }
      await expect(p).rejects.toThrow(/redirect loop/)
      expect(InAppBrowser.close).toHaveBeenCalled()
    })

    it('test_costco_startLogin_does_not_trip_on_benign_burst_then_user_progress', async () => {
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      fireUrlChange(`${WCS_ERR_URL}&n=1`)
      fireUrlChange(`${WCS_ERR_URL}&n=2`)
      fireUrlChange(`${WCS_ERR_URL}&n=3`)
      fireUrlChange(
        'https://signin.costco.com/api/CombinedSigninAndSignup/unified?claimsexchange=SignInWithOTPUsingEmailAddressExchange'
      )
      for (let i = 0; i < 6; i++) {
        fireUrlChange(`${WCS_ERR_URL}&after=${i}`)
      }
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
      await expect(p).resolves.toMatchObject({ idToken: FAKE_ID_TOKEN_XYZ789 })
    })

    it('test_evaluateLoginLoopDetection_resets_on_interactive_url', async () => {
      const { evaluateLoginLoopDetection } = await import('../services/webViewBridge.js')
      const loopDetection = {
        loopUrlPattern: /wcs-err(?:=|%3d)true/i,
        resetUrlPatterns: ['claimsexchange='],
        threshold: 3,
        windowMs: 30000,
      }
      const state = { loopHits: 0, loopWindowStart: Date.now() }
      evaluateLoginLoopDetection(`${WCS_ERR_URL}&a=1`, loopDetection, state)
      evaluateLoginLoopDetection(`${WCS_ERR_URL}&a=2`, loopDetection, state)
      expect(state.loopHits).toBe(2)
      evaluateLoginLoopDetection(
        'https://signin.costco.com/unified?claimsexchange=foo',
        loopDetection,
        state
      )
      expect(state.loopHits).toBe(0)
    })

    it('test_evaluateLoginLoopDetection_post_auth_trips_after_confirmed_and_wcs_err', async () => {
      const { evaluateLoginLoopDetection } = await import('../services/webViewBridge.js')
      const loopDetection = {
        loopUrlPattern: /wcs-err(?:=|%3d)true/i,
        resetUrlPatterns: ['CombinedSigninAndSignup'],
        threshold: 10,
        windowMs: 30000,
        errorMessage: 'pre-auth loop',
        authCompletePatterns: ['CombinedSigninAndSignup/confirmed', 'OAuthLogonCmd'],
        postAuthThreshold: 2,
        postAuthWindowMs: 20000,
        postAuthErrorMessage: 'post-auth wcs-err',
      }
      const state = {
        loopHits: 0,
        loopWindowStart: Date.now(),
        authComplete: false,
        postAuthHits: 0,
        postAuthWindowStart: Date.now(),
      }
      evaluateLoginLoopDetection(`${WCS_ERR_URL}&pre=1`, loopDetection, state)
      evaluateLoginLoopDetection(`${WCS_ERR_URL}&pre=2`, loopDetection, state)
      expect(state.authComplete).toBe(false)
      expect(state.loopHits).toBe(2)

      evaluateLoginLoopDetection(
        'https://signin.costco.com/api/CombinedSigninAndSignup/confirmed?rememberMe=true',
        loopDetection,
        state
      )
      expect(state.authComplete).toBe(true)
      expect(state.loopHits).toBe(0)

      const r1 = evaluateLoginLoopDetection(`${WCS_ERR_URL}&post=1`, loopDetection, state)
      expect(r1.tripped).toBe(false)
      const r2 = evaluateLoginLoopDetection(`${WCS_ERR_URL}&post=2`, loopDetection, state)
      expect(r2.tripped).toBe(true)
      expect(r2.reason).toBe('post-auth')
      expect(r2.errorMessage).toBe('post-auth wcs-err')
    })

    it('test_evaluateLoginLoopDetection_pre_auth_wcs_err_does_not_trip_post_auth_path', async () => {
      const { evaluateLoginLoopDetection } = await import('../services/webViewBridge.js')
      const loopDetection = {
        loopUrlPattern: /wcs-err(?:=|%3d)true/i,
        resetUrlPatterns: [],
        threshold: 10,
        windowMs: 30000,
        errorMessage: 'pre-auth loop',
        authCompletePatterns: ['CombinedSigninAndSignup/confirmed'],
        postAuthThreshold: 2,
        postAuthWindowMs: 20000,
        postAuthErrorMessage: 'post-auth wcs-err',
      }
      const state = {
        loopHits: 0,
        loopWindowStart: Date.now(),
        authComplete: false,
        postAuthHits: 0,
        postAuthWindowStart: Date.now(),
      }
      for (let i = 0; i < 5; i++) {
        const r = evaluateLoginLoopDetection(`${WCS_ERR_URL}&n=${i}`, loopDetection, state)
        expect(r.tripped).toBe(false)
        expect(r.reason).toBeNull()
      }
      expect(state.authComplete).toBe(false)
    })

    it('test_costco_startLogin_rejects_on_post_auth_wcs_err_after_confirmed', async () => {
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      fireUrlChange(
        'https://signin.costco.com/api/CombinedSigninAndSignup/confirmed?rememberMe=true'
      )
      fireUrlChange('https://www.costco.com/OAuthLogonCmd')
      fireUrlChange(`${WCS_ERR_URL}&post=1`)
      fireUrlChange(`${WCS_ERR_URL}&post=2`)
      await expect(p).rejects.toThrow(/finish connecting your account/)
      expect(InAppBrowser.close).toHaveBeenCalled()
    })

    it('test_costco_cookie_probe_calls_getCookies_on_OAuthLogonCmd', async () => {
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      InAppBrowser.getCookies.mockResolvedValue({ WC_SESSION: 'x', _abck: 'y' })
      fireUrlChange('https://www.costco.com/OAuthLogonCmd')
      await Promise.resolve()
      expect(InAppBrowser.getCookies).toHaveBeenCalledWith({
        url: 'https://www.costco.com',
        includeHttpOnly: true,
      })
      expect(InAppBrowser.getCookies).toHaveBeenCalledWith({
        url: 'https://signin.costco.com',
        includeHttpOnly: true,
      })
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
      await p
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

    it('test_costco_extract_script_posts_object_shaped_debug_on_script_run', async () => {
      const { getExtractScript } = await import('../services/costcoExtractScript.js')
      const posts = []
      const prevPollActive = window.__costcoPollActive
      const prevMobileApp = window.mobileApp
      window.__costcoPollActive = true
      window.mobileApp = { postMessage: (m) => posts.push(m) }
      try {
        // eslint-disable-next-line no-new-func
        new Function(getExtractScript('https://example.com/graphql'))()
      } finally {
        window.__costcoPollActive = prevPollActive
        window.mobileApp = prevMobileApp
      }
      const scriptRun = posts.find((p) => p?.detail?.message === 'script_run')
      expect(scriptRun).toBeDefined()
      expect(typeof scriptRun).toBe('object')
      expect(scriptRun.detail.type).toBe('costco-webview-fetch-debug')
    })

    it('test_costco_diagnostic_script_posts_object_shaped_login_diagnostic', async () => {
      const { getDiagnosticScript } = await import('../services/costcoExtractScript.js')
      const posts = []
      const fakeWin = {
        mobileApp: { postMessage: (m) => posts.push(m) },
        __costcoLoginDiagHosts: {},
        localStorage: { length: 0, key: () => null },
        location: { href: 'https://signin.costco.com/', hostname: 'signin.costco.com' },
        navigator: { userAgent: 'test-ua' },
        document: { cookie: '' },
      }
      // eslint-disable-next-line no-new-func
      new Function('window', `with(window){ ${getDiagnosticScript()} }`)(fakeWin)
      expect(posts).toHaveLength(1)
      expect(typeof posts[0]).toBe('object')
      expect(posts[0].detail.type).toBe('costco-webview-fetch-debug')
      expect(posts[0].detail.message).toBe('login-diagnostic')
    })

    it('test_normalizeWebViewMessageDetail_parses_ios_rawMessage_json_string', async () => {
      const { normalizeWebViewMessageDetail } = await import('../services/webViewBridge.js')
      const inner = {
        type: 'costco-webview-fetch-debug',
        message: 'doFetchReceipts entry',
        data: { tokenLen: 120 },
      }
      const normalized = normalizeWebViewMessageDetail({
        detail: { rawMessage: JSON.stringify({ detail: inner }) },
      })
      expect(normalized).toMatchObject(inner)
    })

    it('test_costco_debug_message_reaches_dev_log_for_object_and_rawMessage_shapes', async () => {
      const fetchSpy = vi.fn(() => Promise.resolve({ ok: true }))
      vi.stubGlobal('fetch', fetchSpy)
      try {
        const { startLogin } = await import('../services/costcoWebViewBridge.js')
        const p = startLogin()
        await flushUntilListenersReady()

        fireMessage({
          type: 'costco-webview-fetch-debug',
          message: 'doFetchReceipts entry',
          data: { tokenLen: 120 },
        })
        fireMessage({
          rawMessage: JSON.stringify({
            detail: {
              type: 'costco-webview-fetch-debug',
              message: 'script_run',
              data: {},
            },
          }),
        })

        await Promise.resolve()
        const bodies = fetchSpy.mock.calls.map((c) => String(c[1]?.body || ''))
        expect(bodies.some((b) => b.includes('doFetchReceipts entry'))).toBe(true)
        expect(bodies.some((b) => b.includes('script_run'))).toBe(true)
        expect(ibState.messageListeners.length).toBeGreaterThan(0)

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
        await p
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })

  describe('group G — InAppBrowser session mutex', () => {
    it('SILENT_SKIPS_WHILE_LOGIN_ACTIVE — no second openWebView; silent timeout does not close login', async () => {
      const { startLogin, startSilentSync } = await import('../services/costcoWebViewBridge.js')
      const loginPromise = startLogin()
      await flushUntilListenersReady()
      expect(InAppBrowser.openWebView).toHaveBeenCalledTimes(1)

      const silentPromise = startSilentSync()
      await expect(silentPromise).resolves.toEqual({ _skipped: true, reason: 'webview_busy' })
      expect(InAppBrowser.openWebView).toHaveBeenCalledTimes(1)

      const closeCountBefore = InAppBrowser.close.mock.calls.length
      await vi.advanceTimersByTimeAsync(45_000)
      await Promise.resolve()
      expect(InAppBrowser.close.mock.calls.length).toBe(closeCountBefore)

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
      await loginPromise
    })

    it('LOGIN_PREEMPTS_SILENT — silent resolves preempted; login opens WebView', async () => {
      const { startLogin, startSilentSync } = await import('../services/costcoWebViewBridge.js')
      const silentPromise = startSilentSync()
      await vi.waitFor(() => {
        expect(InAppBrowser.openWebView).toHaveBeenCalledTimes(1)
      })

      const loginPromise = startLogin()
      await expect(silentPromise).resolves.toEqual({ _skipped: true, reason: 'preempted' })
      await flushUntilListenersReady()
      expect(InAppBrowser.openWebView.mock.calls.length).toBeGreaterThanOrEqual(2)

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
      await loginPromise
    })

    it('CROSS_PROVIDER_SILENT_EXCLUSIVE — safeway silent skips while costco silent active', async () => {
      const { startSilentSync: costcoSilent } = await import('../services/costcoWebViewBridge.js')
      const { startSilentSync: safewaySilent } = await import('../services/safewayWebViewBridge.js')
      const costcoPromise = costcoSilent()
      await vi.waitFor(() => {
        expect(InAppBrowser.openWebView).toHaveBeenCalledTimes(1)
      })

      await expect(safewaySilent()).resolves.toEqual({ _skipped: true, reason: 'webview_busy' })
      expect(InAppBrowser.openWebView).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(45_000)
      await costcoPromise
    })

    it('TIMEOUT_STILL_NULL_WHEN_ALONE — silent alone times out to null', async () => {
      const { startSilentSync } = await import('../services/costcoWebViewBridge.js')
      const silentPromise = startSilentSync()
      await vi.waitFor(() => {
        expect(InAppBrowser.openWebView).toHaveBeenCalledTimes(1)
      })
      await vi.advanceTimersByTimeAsync(45_000)
      await expect(silentPromise).resolves.toBeNull()
      expect(InAppBrowser.close).toHaveBeenCalled()
    })
  })
})
