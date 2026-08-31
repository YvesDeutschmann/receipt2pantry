/**
 * Contract tests for WebView bridges (schema + lifecycle); no real WebView or retailer DOM.
 * @see docs/implementation_briefs/test_coverage/tier_3_frontend/t3-08-webViewBridge.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/** Easily grepable fake secrets — must never appear in console.log args */
const FAKE_ACCESS_TOKEN_ABC123 = 'FAKE_ACCESS_TOKEN_ABC123'
const FAKE_ID_TOKEN_XYZ789 = 'FAKE_ID_TOKEN_XYZ789'

const { ibState, InAppBrowser } = vi.hoisted(() => {
  let nextWebViewId = 1
  const state = {
    messageListeners: [],
    closeListeners: [],
    urlListeners: [],
    pageLoadedListeners: [],
    activeWebViewId: null,
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
      else if (event === 'browserPageLoaded') state.pageLoadedListeners.push(cb)
      return {
        remove: vi.fn(() => {
          if (event === 'messageFromWebview') removeFrom(state.messageListeners, cb)
          else if (event === 'closeEvent') removeFrom(state.closeListeners, cb)
          else if (event === 'urlChangeEvent') removeFrom(state.urlListeners, cb)
          else if (event === 'browserPageLoaded') removeFrom(state.pageLoadedListeners, cb)
        }),
      }
    }),
    openWebView: vi.fn(() => {
      const id = `test-wv-${nextWebViewId++}`
      state.activeWebViewId = id
      return Promise.resolve({ id })
    }),
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
  getEffectiveApiBaseUrl: vi.fn(() => ({ url: 'http://localhost:5000/api' })),
  postDevLog: vi.fn(),
}))

const syncLogMocks = vi.hoisted(() => ({
  beginSyncAttempt: vi.fn(() => 'test-sync-id'),
  getActiveSyncId: vi.fn(() => 'test-sync-id'),
  logPhase: vi.fn(() => Promise.resolve()),
  reportAnomaly: vi.fn(() => Promise.resolve()),
}))

vi.mock('../services/syncEventLog.js', () => ({
  beginSyncAttempt: syncLogMocks.beginSyncAttempt,
  getActiveSyncId: syncLogMocks.getActiveSyncId,
  logPhase: syncLogMocks.logPhase,
  reportAnomaly: syncLogMocks.reportAnomaly,
  SyncPhase: {
    SESSION_BEGIN: 'session_begin',
    SESSION_BUSY: 'session_busy',
    SESSION_PREEMPTED: 'session_preempted',
    WEBVIEW_OPENED: 'webview_opened',
    WEBVIEW_OPEN_FAILED: 'webview_open_failed',
    AUTH_COMPLETE: 'auth_complete',
    TOKENS_RECEIVED: 'tokens_received',
    RECEIPTS_RECEIVED: 'receipts_received',
    CLOSE_REQUESTED: 'close_requested',
    CLOSE_CONFIRMED: 'close_confirmed',
    CLOSE_FAILED: 'close_failed',
    CLOSE_SKIPPED_NOT_OWNER: 'close_skipped_not_owner',
    CLOSE_UNCONFIRMED: 'close_unconfirmed',
    LOGIN_TIMEOUT: 'login_timeout',
    SILENT_TIMEOUT: 'silent_timeout',
    CLOSED_EARLY: 'closed_early',
    LOOP_DETECTED: 'loop_detected',
    INGEST_STARTED: 'ingest_started',
    INGEST_FAILED: 'ingest_failed',
    SYNC_SUCCEEDED: 'sync_succeeded',
    SYNC_FAILED: 'sync_failed',
    SYNC_SKIPPED: 'sync_skipped',
    NEEDS_RECONNECT: 'needs_reconnect',
    DIAGNOSTIC_CHECKPOINT: 'diagnostic_checkpoint',
    TOKEN_EXCHANGE: 'token_exchange',
    WEBVIEW_ORPHAN_CLOSED: 'webview_orphan_closed',
  },
}))

function makeBrowserStorage() {
  const map = new Map()
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(String(k), String(v))
    },
    removeItem: (k) => {
      map.delete(k)
    },
    clear: () => {
      map.clear()
    },
  }
}

async function runCostcoExtractCensus({ lsEntries = {}, ssEntries = {} } = {}) {
  const { getExtractScript } = await import('../services/costcoExtractScript.js')
  const posts = []
  const ls = makeBrowserStorage()
  const ss = makeBrowserStorage()
  for (const [k, v] of Object.entries(lsEntries)) ls.setItem(k, v)
  for (const [k, v] of Object.entries(ssEntries)) ss.setItem(k, v)
  const prevPoll = window.__costcoPollActive
  const prevMobile = window.mobileApp
  const prevLs = window.localStorage
  const prevSs = window.sessionStorage
  window.__costcoPollActive = false
  window.mobileApp = { postMessage: (m) => posts.push(m) }
  vi.stubGlobal('localStorage', ls)
  vi.stubGlobal('sessionStorage', ss)
  vi.stubGlobal('location', {
    hostname: 'www.costco.com',
    href: 'https://www.costco.com/myaccount',
    hash: '',
  })
  window.__costcoDiagCount = 0
  window.__costcoDiagLastMs = 0
  window.__costcoCensusCount = 0
  window.__costcoCensusLastMs = 0
  try {
    // eslint-disable-next-line no-new-func
    new Function(getExtractScript('https://example.com/graphql'))()
    await vi.advanceTimersByTimeAsync(500)
    return posts.find((p) => p?.detail?.message === 'msal-census')
  } finally {
    window.__costcoPollActive = prevPoll
    window.mobileApp = prevMobile
    vi.stubGlobal('localStorage', prevLs)
    vi.stubGlobal('sessionStorage', prevSs)
  }
}

function fireMessage(detail, id) {
  const eventId = id ?? ibState.activeWebViewId
  for (const cb of [...ibState.messageListeners]) {
    cb(eventId ? { detail, id: eventId } : { detail })
  }
}

function fireClose(id) {
  const eventId = id ?? ibState.activeWebViewId
  for (const cb of [...ibState.closeListeners]) {
    cb(eventId ? { id: eventId } : {})
  }
}

function fireUrlChange(url, id) {
  const eventId = id ?? ibState.activeWebViewId
  for (const cb of [...ibState.urlListeners]) {
    cb(eventId ? { url, id: eventId } : { url })
  }
}

async function flushUntilListenersReady() {
  for (let i = 0; i < 12; i += 1) {
    if (ibState.messageListeners.length > 0) return
    await vi.advanceTimersByTimeAsync(250)
    await Promise.resolve()
  }
  expect(ibState.messageListeners.length).toBeGreaterThan(0)
}

/** closeListeners may retain one process-wide registry listener from webViewInstances. */
function expectSessionListenersCleared() {
  expect(ibState.urlListeners.length).toBe(0)
  expect(ibState.messageListeners.length).toBe(0)
}

/** closeBrowserForSession waits 3s for closeEvent verification; allow close() retry delays */
async function advanceCloseVerification() {
  await vi.advanceTimersByTimeAsync(1000)
  await vi.advanceTimersByTimeAsync(3000)
}

/** Fire tokens/receipts message, wait for close flow, advance verification timer, await bridge promise */
async function completeBridgeFlow(p, message = costcoTokensMessage, { confirmClose = false } = {}) {
  fireMessage(message)
  await vi.waitFor(() =>
    syncLogMocks.logPhase.mock.calls.some(([, phase]) => phase === 'close_requested')
  )
  await vi.waitFor(() => InAppBrowser.close.mock.calls.length > 0)
  await Promise.resolve()
  await vi.advanceTimersByTimeAsync(1)
  if (confirmClose) fireClose()
  await advanceCloseVerification()
  return await p
}

const costcoTokensMessage = {
  type: 'costco-tokens',
  idToken: FAKE_ID_TOKEN_XYZ789,
  accessToken: FAKE_ACCESS_TOKEN_ABC123,
  clientID: 'cid',
  wcsClientId: 'wcs',
  refreshToken: 'rt',
  refreshTokenClientId: 'rtc',
  userAgent: 'ua',
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
    ibState.pageLoadedListeners = []
    ibState.activeWebViewId = null
    InAppBrowser.getCookies.mockResolvedValue({})
    InAppBrowser.close.mockImplementation(() => Promise.resolve())
    InAppBrowser.openWebView.mockImplementation(() => {
      const id = `test-wv-${Date.now()}`
      ibState.activeWebViewId = id
      return Promise.resolve({ id })
    })
    vi.useFakeTimers({ shouldAdvanceTime: false })
  })

  beforeEach(async () => {
    const { forceReleaseWebViewSession } = await import('../services/webViewBridge.js')
    const { _resetWebViewInstancesForTests } = await import('../services/webViewInstances.js')
    forceReleaseWebViewSession()
    _resetWebViewInstancesForTests()
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
      await completeBridgeFlow(p)
    })

    it('test_clearCostcoInAppBrowserSession_calls_clearAllCookies_and_clearCache', async () => {
      const { clearCostcoInAppBrowserSession } = await import('../services/costcoWebViewBridge.js')
      await clearCostcoInAppBrowserSession()
      expect(InAppBrowser.clearAllCookies).toHaveBeenCalled()
      expect(InAppBrowser.clearCache).toHaveBeenCalled()
    })

    it('test_costco_startLogin_returns_object_with_required_token_keys', async () => {
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      const result = await completeBridgeFlow(p)
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
      const result = await completeBridgeFlow(p, {
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
      expect(result._fromWebView).toBe(true)
      expect(result.receipts).toEqual([])
    })

    it('test_costco_close_after_fetch_flag_set_when_user_never_navigated_to_orders', async () => {
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      const result = await completeBridgeFlow(p, {
        type: 'costco-tokens',
        idToken: FAKE_ID_TOKEN_XYZ789,
        accessToken: FAKE_ACCESS_TOKEN_ABC123,
        clientID: 'c1',
        wcsClientId: 'w1',
        refreshToken: 'r1',
        refreshTokenClientId: 'rc1',
        userAgent: 'ua',
      })
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
      await completeBridgeFlow(p)
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
        String(c[0]?.code || '').includes('__costcoPollActive')
      )
      expect(extractCalls).toHaveLength(0)
      const diagCalls = InAppBrowser.executeScript.mock.calls.filter((c) =>
        String(c[0]?.code || '').includes('__costcoDiagProbePageKey')
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
      await completeBridgeFlow(p)
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
      await completeBridgeFlow(p)
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
      const result = await completeBridgeFlow(p)
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
      const result = await completeBridgeFlow(p)
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
      await completeBridgeFlow(p)
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

      await completeBridgeFlow(p)

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
      await expect(completeBridgeFlow(p)).resolves.toMatchObject({ idToken: FAKE_ID_TOKEN_XYZ789 })
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
      await completeBridgeFlow(p)
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

    it('test_costco_startLogin_unrecoverable_wipes_msal_once', async () => {
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      InAppBrowser.executeScript.mockClear()
      fireMessage({ type: 'costco-silent-unrecoverable', reason: 'refresh_invalid_grant' })
      await vi.waitFor(() =>
        InAppBrowser.executeScript.mock.calls.some((c) =>
          String(c[0]?.code || '').includes('__costcoMsalRebootstrap')
        )
      )
      fireMessage({ type: 'costco-silent-unrecoverable', reason: 'refresh_invalid_grant' })
      await Promise.resolve()
      const rebootCalls = InAppBrowser.executeScript.mock.calls.filter((c) =>
        String(c[0]?.code || '').includes('__costcoMsalRebootstrap')
      )
      expect(rebootCalls).toHaveLength(1)
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
      await completeBridgeFlow(p)
    })

    it('test_no_pending_promise_leak_after_cancel', async () => {
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      fireClose()
      await expect(p).rejects.toThrow(/WebView closed before tokens were extracted/)

      expectSessionListenersCleared()

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
      await completeBridgeFlow(p1)
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
      await completeBridgeFlow(p2)
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
      await completeBridgeFlow(p)
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

    it('test_normalizeWebViewMessageDetail_parses_string_detail', async () => {
      const { normalizeWebViewMessageDetail } = await import('../services/webViewBridge.js')
      const inner = {
        type: 'costco-tokens',
        idToken: 'tok',
      }
      const normalized = normalizeWebViewMessageDetail({
        detail: JSON.stringify({ detail: inner }),
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
        await advanceCloseVerification()
        await p
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('test_costco_receipts_keeps_message_listener_through_diag_grace', async () => {
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
      await vi.waitFor(() => InAppBrowser.executeScript.mock.calls.length > 0)
      expect(ibState.messageListeners.length).toBeGreaterThan(0)
      await vi.advanceTimersByTimeAsync(800)
      expect(ibState.messageListeners.length).toBeGreaterThan(0)
      await vi.advanceTimersByTimeAsync(1500)
      await advanceCloseVerification()
      await p
      expect(ibState.messageListeners.length).toBe(0)
    })

    it('test_flattenCensusFromDebugMessage_flattens_diag_checkpoint', async () => {
      const { flattenCensusFromDebugMessage } = await import('../services/webViewBridge.js')
      const flat = flattenCensusFromDebugMessage({
        message: 'diag-checkpoint',
        data: {
          checkpoint: 'a1',
          tokenFailureCount: '1',
          hashPresent: false,
          ls: {
            seen: 2,
            idTokens: 1,
            accessTokens: 1,
            expired: 0,
            hasUsableRt: true,
            environments: 'signin.costco.com',
            tfp: 'B2C_1A_SSO_WCS_signup_signin_209',
            minSecondsLeft: 3000,
          },
          ss: { seen: 0, idTokens: 0, accessTokens: 0, expired: 0, hasUsableRt: false },
        },
      })
      expect(flat).toMatchObject({
        checkpoint: 'a1',
        censusSeen: 2,
        censusIdTokens: 1,
        censusAccessTokens: 1,
        censusTfp: 'B2C_1A_SSO_WCS_signup_signin_209',
        censusTokenFailureCount: '1',
      })
    })

    it('test_flattenCensusFromDebugMessage_flattens_token_exchange', async () => {
      const { flattenCensusFromDebugMessage } = await import('../services/webViewBridge.js')
      const flat = flattenCensusFromDebugMessage({
        message: 'token-exchange',
        data: {
          fired: false,
          status: 0,
          policy: '',
          error: '',
          errorDescription: '',
          source: 'missed',
          sweepRuns: 42,
        },
      })
      expect(flat).toMatchObject({
        tokenFired: false,
        tokenSource: 'missed',
        tokenSweepRuns: 42,
      })
    })

    it('test_flattenCensusFromDebugMessage_flattens_msal_tokens_found', async () => {
      const { flattenCensusFromDebugMessage } = await import('../services/webViewBridge.js')
      const flat = flattenCensusFromDebugMessage({
        message: 'msal-tokens-found',
        data: {
          tfp: 'B2C_1A_SSO_WCS_signup_signin_209',
          idSecondsLeft: 3500,
          accSecondsLeft: 3400,
          hasAccess: true,
          hasRt: true,
        },
      })
      expect(flat).toMatchObject({
        checkpoint: 'tokens-found',
        tfp: 'B2C_1A_SSO_WCS_signup_signin_209',
        idSecondsLeft: 3500,
        accSecondsLeft: 3400,
        hasAccess: true,
        hasRt: true,
      })
    })

    it('test_flattenCensusFromDebugMessage_flattens_token_exchange_observed', async () => {
      const { flattenCensusFromDebugMessage } = await import('../services/webViewBridge.js')
      const flat = flattenCensusFromDebugMessage({
        message: 'token-exchange',
        data: {
          fired: true,
          status: 400,
          policy: 'b2c_1a_sso_wcs_signup_signin_209',
          error: 'invalid_grant',
          errorDescription: 'expired token',
          source: 'fetch',
        },
      })
      expect(flat).toMatchObject({
        tokenFired: true,
        tokenStatus: 400,
        tokenPolicy: 'b2c_1a_sso_wcs_signup_signin_209',
        tokenError: 'invalid_grant',
      })
    })

    it('test_flattenCensusFromDebugMessage_flattens_msal_census_scalars', async () => {
      const { flattenCensusFromDebugMessage } = await import('../services/webViewBridge.js')
      const flat = flattenCensusFromDebugMessage({
        message: 'msal-census',
        data: {
          reason: 'expired_id_rt_present',
          tokenFailureCount: '2',
          ls: {
            seen: 2,
            idTokens: 1,
            expired: 1,
            hasUsableRt: true,
            environments: 'signin.costco.com',
          },
          ss: { seen: 0, idTokens: 0, expired: 0, hasUsableRt: false, environments: '' },
        },
      })
      expect(flat).toMatchObject({
        censusReason: 'expired_id_rt_present',
        censusSeen: 2,
        censusIdTokens: 1,
        censusExpired: 1,
        censusHasRt: true,
        censusTokenFailureCount: '2',
      })
    })

    it('test_costco_extract_nonce_reset_clears_rt_refresh_latch', async () => {
      const { getExtractScript } = await import('../services/costcoExtractScript.js')
      const posts = []
      const prevPoll = window.__costcoPollActive
      const prevMobile = window.mobileApp
      window.__costcoPollActive = false
      window.__costcoRtRefreshStarted = true
      window.__mealdSyncNonceSeen = 'old-nonce'
      window.__mealdSyncNonce = 'new-nonce-abc'
      window.mobileApp = { postMessage: (m) => posts.push(m) }
      vi.stubGlobal('localStorage', makeBrowserStorage())
      vi.stubGlobal('sessionStorage', makeBrowserStorage())
      vi.stubGlobal('location', {
        hostname: 'www.costco.com',
        href: 'https://www.costco.com/myaccount',
        hash: '',
      })
      try {
        // eslint-disable-next-line no-new-func
        new Function(getExtractScript('https://example.com/graphql'))()
        const scriptRun = posts.find((p) => p?.detail?.message === 'script_run')
        expect(scriptRun?.detail?.data?.reset).toBe(true)
        expect(window.__costcoRtRefreshStarted).toBe(false)
      } finally {
        window.__costcoPollActive = prevPoll
        window.mobileApp = prevMobile
        delete window.__mealdSyncNonce
        delete window.__mealdSyncNonceSeen
        delete window.__costcoRtRefreshStarted
      }
    })

    it('test_costco_extract_s3_force_refresh_invalid_grant', async () => {
      const { makeTestJwt } = await import('../services/costcoMsalTokenHelpers.js')
      const posts = []
      const ls = makeBrowserStorage()
      ls.setItem(
        'msal.id',
        JSON.stringify({
          credentialType: 'IdToken',
          environment: 'signin.costco.com',
          secret: makeTestJwt(3600),
        })
      )
      ls.setItem(
        'msal.rt',
        JSON.stringify({
          credentialType: 'RefreshToken',
          environment: 'signin.costco.com',
          secret: 'revoked',
          clientId: 'client-abc',
        })
      )
      const prevPoll = window.__costcoPollActive
      const prevMobile = window.mobileApp
      const prevFetch = global.fetch
      window.__costcoPollActive = false
      window.__costcoRtRefreshStarted = false
      window.__costcoUnrecoverablePosted = false
      window.__costcoAppRefreshRequested = false
      window.__costcoFetchStarted = false
      window.__costcoReceiptsPosted = false
      window.__costcoRtRefreshAttempts = 0
      window.__costcoRtRefreshBackoffUntil = 0
      window.__costcoS3ForceRefresh = true
      window.mobileApp = { postMessage: (m) => posts.push(m) }
      global.fetch = vi.fn(() =>
        Promise.resolve({
          status: 400,
          text: () => Promise.resolve(JSON.stringify({ error: 'invalid_grant' })),
        })
      )
      vi.stubGlobal('localStorage', ls)
      vi.stubGlobal('sessionStorage', makeBrowserStorage())
      vi.stubGlobal('location', {
        hostname: 'www.costco.com',
        href: 'https://www.costco.com/myaccount',
        hash: '',
      })
      try {
        const { getExtractScript } = await import('../services/costcoExtractScript.js')
        // eslint-disable-next-line no-new-func
        new Function(getExtractScript('https://example.com/graphql'))()
        await vi.advanceTimersByTimeAsync(500)
        const unrecoverable = posts.find((p) => p?.detail?.type === 'costco-silent-unrecoverable')
        expect(unrecoverable).toBeDefined()
        expect(unrecoverable.detail.reason).toBe('refresh_invalid_grant')
        const refreshStart = posts.find((p) => p?.detail?.message === 'rt-refresh-start')
        expect(refreshStart).toBeDefined()
      } finally {
        delete window.__costcoS3ForceRefresh
        window.__costcoPollActive = prevPoll
        window.mobileApp = prevMobile
        global.fetch = prevFetch
      }
    })

    it('test_costco_extract_s3_cors_does_not_request_app_refresh', async () => {
      const { makeTestJwt } = await import('../services/costcoMsalTokenHelpers.js')
      const posts = []
      const ls = makeBrowserStorage()
      ls.setItem(
        'msal.id',
        JSON.stringify({
          credentialType: 'IdToken',
          environment: 'signin.costco.com',
          secret: makeTestJwt(3600),
        })
      )
      ls.setItem(
        'msal.rt',
        JSON.stringify({
          credentialType: 'RefreshToken',
          environment: 'signin.costco.com',
          secret: 'revoked',
          clientId: 'client-abc',
        })
      )
      const prevPoll = window.__costcoPollActive
      const prevMobile = window.mobileApp
      const prevFetch = global.fetch
      window.__costcoPollActive = false
      window.__costcoRtRefreshStarted = false
      window.__costcoUnrecoverablePosted = false
      window.__costcoAppRefreshRequested = false
      window.__costcoFetchStarted = false
      window.__costcoReceiptsPosted = false
      window.__costcoRtRefreshAttempts = 0
      window.__costcoRtRefreshBackoffUntil = 0
      window.__costcoS3ForceRefresh = true
      window.mobileApp = { postMessage: (m) => posts.push(m) }
      global.fetch = vi.fn(() => Promise.reject(new Error('Failed to fetch')))
      vi.stubGlobal('localStorage', ls)
      vi.stubGlobal('sessionStorage', makeBrowserStorage())
      vi.stubGlobal('location', {
        hostname: 'www.costco.com',
        href: 'https://www.costco.com/myaccount',
        hash: '',
      })
      try {
        const { getExtractScript } = await import('../services/costcoExtractScript.js')
        // eslint-disable-next-line no-new-func
        new Function(getExtractScript('https://example.com/graphql'))()
        await vi.advanceTimersByTimeAsync(500)
        const appRefresh = posts.find((p) => p?.detail?.type === 'costco-app-refresh-request')
        expect(appRefresh).toBeUndefined()
      } finally {
        delete window.__costcoS3ForceRefresh
        window.__costcoPollActive = prevPoll
        window.mobileApp = prevMobile
        global.fetch = prevFetch
      }
    })

    it('test_costco_extract_live_jwt_without_force_refresh_skips_rt_refresh', async () => {
      const { makeTestJwt } = await import('../services/costcoMsalTokenHelpers.js')
      const posts = []
      const ls = makeBrowserStorage()
      ls.setItem(
        'msal.id',
        JSON.stringify({
          credentialType: 'IdToken',
          environment: 'signin.costco.com',
          secret: makeTestJwt(3600),
        })
      )
      ls.setItem(
        'msal.rt',
        JSON.stringify({
          credentialType: 'RefreshToken',
          environment: 'signin.costco.com',
          secret: 'x'.repeat(100),
        })
      )
      const prevPoll = window.__costcoPollActive
      const prevMobile = window.mobileApp
      const prevFetch = global.fetch
      window.__costcoPollActive = false
      window.__costcoRtRefreshStarted = false
      window.mobileApp = { postMessage: (m) => posts.push(m) }
      global.fetch = vi.fn(() =>
        Promise.resolve({
          status: 200,
          headers: { get: () => 'application/json' },
          json: () =>
            Promise.resolve({
              data: { receiptsWithCounts: { receipts: [] } },
            }),
        })
      )
      vi.stubGlobal('localStorage', ls)
      vi.stubGlobal('sessionStorage', makeBrowserStorage())
      vi.stubGlobal('location', {
        hostname: 'www.costco.com',
        href: 'https://www.costco.com/myaccount',
        hash: '',
      })
      try {
        const { getExtractScript } = await import('../services/costcoExtractScript.js')
        // eslint-disable-next-line no-new-func
        new Function(getExtractScript('https://example.com/graphql'))()
        await vi.advanceTimersByTimeAsync(500)
        const refreshStart = posts.find((p) => p?.detail?.message === 'rt-refresh-start')
        expect(refreshStart).toBeUndefined()
      } finally {
        window.__costcoPollActive = prevPoll
        window.mobileApp = prevMobile
        global.fetch = prevFetch
      }
    })

    it('test_costco_extract_starts_rt_refresh_on_expired_id_with_rt', async () => {
      const { makeTestJwt } = await import('../services/costcoMsalTokenHelpers.js')
      const posts = []
      const ls = makeBrowserStorage()
      ls.setItem(
        'msal.id',
        JSON.stringify({
          credentialType: 'IdToken',
          environment: 'signin.costco.com',
          secret: makeTestJwt(-3600),
        })
      )
      ls.setItem(
        'msal.rt',
        JSON.stringify({
          credentialType: 'RefreshToken',
          environment: 'signin.costco.com',
          secret: 'x'.repeat(100),
          clientId: 'client-abc',
          homeAccountId:
            'bfc5f2e2-aea6-44ef-abc2-f0c95c397145-b2c_1a_sso_wcs_signup_signin_209.e0714dd4-784d-46d6-a278-3e29553483eb',
          realm: 'e0714dd4-784d-46d6-a278-3e29553483eb',
        })
      )
      const prevPoll = window.__costcoPollActive
      const prevMobile = window.mobileApp
      const prevFetch = global.fetch
      window.__costcoPollActive = false
      window.__costcoRtRefreshStarted = false
      window.__costcoUnrecoverablePosted = false
      window.__costcoAppRefreshRequested = false
      window.__costcoFetchStarted = false
      window.__costcoReceiptsPosted = false
      window.__costcoRtRefreshAttempts = 0
      window.__costcoRtRefreshBackoffUntil = 0
      window.mobileApp = { postMessage: (m) => posts.push(m) }
      global.fetch = vi.fn(() =>
        Promise.resolve({
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                id_token: makeTestJwt(3600),
                refresh_token: 'rotated-rt',
              })
            ),
        })
      )
      vi.stubGlobal('localStorage', ls)
      vi.stubGlobal('sessionStorage', makeBrowserStorage())
      vi.stubGlobal('location', {
        hostname: 'www.costco.com',
        href: 'https://www.costco.com/myaccount',
        hash: '',
      })
      try {
        const { getExtractScript } = await import('../services/costcoExtractScript.js')
        // eslint-disable-next-line no-new-func
        new Function(getExtractScript('https://example.com/graphql'))()
        await vi.advanceTimersByTimeAsync(500)
        const refreshStart = posts.find((p) => p?.detail?.message === 'rt-refresh-start')
        expect(refreshStart).toBeDefined()
        expect(refreshStart.detail.data.source).toBe('page')
      } finally {
        window.__costcoPollActive = prevPoll
        window.mobileApp = prevMobile
        global.fetch = prevFetch
      }
    })

    it('test_costco_extract_starts_rt_refresh_on_unparseable_id_with_rt', async () => {
      const posts = []
      const ls = makeBrowserStorage()
      ls.setItem(
        'msal.id',
        JSON.stringify({
          credentialType: 'IdToken',
          environment: 'signin.costco.com',
          secret: 'not-a-jwt',
        })
      )
      ls.setItem(
        'msal.rt',
        JSON.stringify({
          credentialType: 'RefreshToken',
          environment: 'signin.costco.com',
          secret: 'x'.repeat(100),
          clientId: 'client-abc',
          homeAccountId:
            'bfc5f2e2-aea6-44ef-abc2-f0c95c397145-b2c_1a_sso_wcs_signup_signin_209.e0714dd4-784d-46d6-a278-3e29553483eb',
          realm: 'e0714dd4-784d-46d6-a278-3e29553483eb',
        })
      )
      const prevPoll = window.__costcoPollActive
      const prevMobile = window.mobileApp
      const prevFetch = global.fetch
      window.__costcoPollActive = false
      window.__costcoRtRefreshStarted = false
      window.__costcoUnrecoverablePosted = false
      window.__costcoAppRefreshRequested = false
      window.__costcoFetchStarted = false
      window.__costcoReceiptsPosted = false
      window.__costcoRtRefreshAttempts = 0
      window.__costcoRtRefreshBackoffUntil = 0
      window.mobileApp = { postMessage: (m) => posts.push(m) }
      global.fetch = vi.fn(() =>
        Promise.resolve({
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ id_token: 'x'.repeat(60) })),
        })
      )
      vi.stubGlobal('localStorage', ls)
      vi.stubGlobal('sessionStorage', makeBrowserStorage())
      vi.stubGlobal('location', {
        hostname: 'www.costco.com',
        href: 'https://www.costco.com/myaccount',
        hash: '',
      })
      try {
        const { getExtractScript } = await import('../services/costcoExtractScript.js')
        // eslint-disable-next-line no-new-func
        new Function(getExtractScript('https://example.com/graphql'))()
        await vi.advanceTimersByTimeAsync(500)
        const refreshStart = posts.find((p) => p?.detail?.message === 'rt-refresh-start')
        expect(refreshStart).toBeDefined()
      } finally {
        window.__costcoPollActive = prevPoll
        window.mobileApp = prevMobile
        global.fetch = prevFetch
      }
    })

    it('test_costco_extract_msal_census_not_env_mismatch_when_non_json_keys_present', async () => {
      const { makeTestJwt } = await import('../services/costcoMsalTokenHelpers.js')
      const prevFetch = global.fetch
      global.fetch = vi.fn(() =>
        Promise.resolve({
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                id_token: makeTestJwt(3600),
                refresh_token: 'rotated-rt',
              })
            ),
        })
      )
      const posts = []
      const ls = makeBrowserStorage()
      ls.setItem('preferredWarehouse', 'not-json')
      ls.setItem(
        'msal.id',
        JSON.stringify({
          credentialType: 'IdToken',
          environment: 'signin.costco.com',
          secret: makeTestJwt(-3600),
        })
      )
      ls.setItem(
        'msal.rt',
        JSON.stringify({
          credentialType: 'RefreshToken',
          environment: 'signin.costco.com',
          secret: 'x'.repeat(100),
        })
      )
      const prevPoll = window.__costcoPollActive
      const prevMobile = window.mobileApp
      window.__costcoPollActive = false
      window.__costcoRtRefreshStarted = false
      window.__costcoUnrecoverablePosted = false
      window.__costcoAppRefreshRequested = false
      window.__costcoFetchStarted = false
      window.__costcoReceiptsPosted = false
      window.__costcoRtRefreshAttempts = 0
      window.__costcoRtRefreshBackoffUntil = 0
      window.mobileApp = { postMessage: (m) => posts.push(m) }
      vi.stubGlobal('localStorage', ls)
      vi.stubGlobal('sessionStorage', makeBrowserStorage())
      vi.stubGlobal('location', {
        hostname: 'www.costco.com',
        href: 'https://www.costco.com/myaccount',
        hash: '',
      })
      try {
        const { getExtractScript } = await import('../services/costcoExtractScript.js')
        // eslint-disable-next-line no-new-func
        new Function(getExtractScript('https://example.com/graphql'))()
        await vi.advanceTimersByTimeAsync(500)
        const refreshStart = posts.find((p) => p?.detail?.message === 'rt-refresh-start')
        expect(refreshStart).toBeDefined()
      } finally {
        window.__costcoPollActive = prevPoll
        window.mobileApp = prevMobile
        global.fetch = prevFetch
      }
    })

    it('test_costco_extract_msal_census_no_msal_entries', async () => {
      const census = await runCostcoExtractCensus()
      expect(census?.detail?.data?.reason).toBe('no_msal_entries')
    })

    it('test_costco_extract_msal_census_env_mismatch', async () => {
      const { makeTestJwt } = await import('../services/costcoMsalTokenHelpers.js')
      const census = await runCostcoExtractCensus({
        lsEntries: {
          bad: JSON.stringify({
            credentialType: 'IdToken',
            environment: 'other.example.com',
            secret: makeTestJwt(3600),
          }),
        },
      })
      expect(census?.detail?.data?.reason).toBe('env_mismatch')
    })

    it('test_costco_extract_msal_census_unparseable', async () => {
      const census = await runCostcoExtractCensus({
        lsEntries: {
          bad: JSON.stringify({
            credentialType: 'IdToken',
            environment: 'signin.costco.com',
            secret: 'not-a-jwt',
          }),
        },
      })
      expect(census?.detail?.data?.reason).toBe('unparseable')
    })

    it('test_costco_page_diagnostic_is_rate_limited', async () => {
      const { getExtractScript } = await import('../services/costcoExtractScript.js')
      const posts = []
      const prevPoll = window.__costcoPollActive
      const prevMobile = window.mobileApp
      const prevLs = window.localStorage
      const prevSs = window.sessionStorage
      window.__costcoPollActive = false
      window.__costcoRtRefreshStarted = false
      window.__costcoUnrecoverablePosted = false
      window.__costcoAppRefreshRequested = false
      window.__costcoFetchStarted = false
      window.__costcoReceiptsPosted = false
      window.__costcoRtRefreshAttempts = 0
      window.__costcoRtRefreshBackoffUntil = 0
      window.mobileApp = { postMessage: (m) => posts.push(m) }
      vi.stubGlobal('localStorage', makeBrowserStorage())
      vi.stubGlobal('sessionStorage', makeBrowserStorage())
      vi.stubGlobal('location', {
        hostname: 'www.costco.com',
        href: 'https://www.costco.com/myaccount',
        hash: '',
      })
      window.__costcoDiagCount = 0
      window.__costcoDiagLastMs = 0
      window.__costcoCensusCount = 0
      window.__costcoCensusLastMs = 0
      try {
        // eslint-disable-next-line no-new-func
        new Function(getExtractScript('https://example.com/graphql'))()
        await vi.advanceTimersByTimeAsync(500)
        const early = posts.filter((p) => p?.detail?.message === 'page-diagnostic')
        expect(early.length).toBe(1)
        await vi.advanceTimersByTimeAsync(3500)
        const later = posts.filter((p) => p?.detail?.message === 'page-diagnostic')
        expect(later.length).toBeGreaterThan(1)
      } finally {
        window.__costcoPollActive = prevPoll
        window.mobileApp = prevMobile
        vi.stubGlobal('localStorage', prevLs)
        vi.stubGlobal('sessionStorage', prevSs)
      }
    })
  })

  describe('group G — InAppBrowser session mutex', () => {
    it('SILENT_SINGLE_INJECT — nonce + smash + extract in one executeScript', async () => {
      const prevDevSettings = import.meta.env.VITE_ENABLE_DEV_SETTINGS
      import.meta.env.VITE_ENABLE_DEV_SETTINGS = '1'
      const ls = makeBrowserStorage()
      ls.setItem('COSTCO_S3_SMASH_RT', '1')
      vi.stubGlobal('localStorage', ls)
      const { startSilentSync } = await import('../services/costcoWebViewBridge.js')
      const { postDevLog } = await import('../services/apiClient.js')
      const silentPromise = startSilentSync()
      await vi.waitFor(() => {
        expect(InAppBrowser.openWebView).toHaveBeenCalled()
      })
      await vi.waitFor(() => {
        const injectCall = InAppBrowser.executeScript.mock.calls.find((c) =>
          String(c[0]?.code || '').includes('__mealdSyncNonce')
        )
        expect(injectCall).toBeDefined()
      })
      const injectCall = InAppBrowser.executeScript.mock.calls.find((c) =>
        String(c[0]?.code || '').includes('__mealdSyncNonce')
      )
      const firstCode = injectCall[0].code
      expect(firstCode).toContain('s3-smash-rt')
      expect(firstCode).toContain('script_run')
      const nonceCalls = InAppBrowser.executeScript.mock.calls.filter((c) =>
        String(c[0]?.code || '').includes('__mealdSyncNonce')
      )
      for (const call of nonceCalls) {
        expect(call[0].code).toContain('script_run')
      }
      expect(postDevLog).toHaveBeenCalledWith('costcoSilent', 's3_smash consumed=1')
      await vi.advanceTimersByTimeAsync(45_000)
      await silentPromise
      import.meta.env.VITE_ENABLE_DEV_SETTINGS = prevDevSettings
    })

    it('LOGIN_SINGLE_INJECT — nonce prefix without smash', async () => {
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const loginPromise = startLogin()
      await flushUntilListenersReady()
      fireUrlChange('https://www.costco.com/')
      await vi.waitFor(() => {
        const extractCalls = InAppBrowser.executeScript.mock.calls.filter((c) =>
          String(c[0]?.code || '').includes('script_run')
        )
        return extractCalls.length > 0
      })
      const extractCalls = InAppBrowser.executeScript.mock.calls.filter((c) =>
        String(c[0]?.code || '').includes('script_run')
      )
      const firstCode = extractCalls[0][0].code
      expect(firstCode).toContain('__mealdSyncNonce')
      expect(firstCode).not.toContain('s3-smash-rt')
      loginPromise.catch(() => {})
    })

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
      await completeBridgeFlow(loginPromise)
    })

    it('LOGIN_PREEMPTS_SILENT — silent resolves preempted; login opens WebView', async () => {
      const { startLogin, startSilentSync } = await import('../services/costcoWebViewBridge.js')
      const silentPromise = startSilentSync()
      await vi.waitFor(() => {
        expect(InAppBrowser.openWebView).toHaveBeenCalledTimes(1)
      })
      await Promise.resolve()

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
      await completeBridgeFlow(loginPromise)
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

  describe('group H — sync close telemetry', () => {
    it('reports close_failed when InAppBrowser.close rejects', async () => {
      const { reportAnomaly, SyncPhase } = await import('../services/syncEventLog.js')
      InAppBrowser.close.mockRejectedValue(new Error('close failed'))
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      fireMessage(costcoTokensMessage)
      await vi.advanceTimersByTimeAsync(5000)
      await p
      expect(reportAnomaly).toHaveBeenCalledWith(
        'costco',
        SyncPhase.CLOSE_FAILED,
        expect.objectContaining({ reason: 'close_api_failed' })
      )
    })

    it('reports close_unconfirmed when closeEvent never fires', async () => {
      const { reportAnomaly, SyncPhase } = await import('../services/syncEventLog.js')
      InAppBrowser.close.mockImplementation(() => Promise.resolve())
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      await completeBridgeFlow(p)
      expect(reportAnomaly).toHaveBeenCalledWith(
        'costco',
        SyncPhase.CLOSE_UNCONFIRMED,
        expect.objectContaining({ reason: 'no_close_event' })
      )
    })

    it('includes census metadata on closed_early when msal-census was received', async () => {
      const { reportAnomaly, SyncPhase } = await import('../services/syncEventLog.js')
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      fireMessage({
        type: 'costco-webview-fetch-debug',
        message: 'msal-census',
        data: {
          reason: 'expired_id_rt_present',
          tokenFailureCount: '3',
          ls: {
            seen: 2,
            idTokens: 1,
            expired: 1,
            hasUsableRt: true,
            environments: 'signin.costco.com',
          },
          ss: { seen: 0, idTokens: 0, expired: 0, hasUsableRt: false, environments: '' },
        },
      })
      fireClose()
      await expect(p).rejects.toThrow(/closed before tokens/i)
      expect(reportAnomaly).toHaveBeenCalledWith(
        'costco',
        SyncPhase.CLOSED_EARLY,
        expect.objectContaining({
          reason: 'user_closed_early',
          censusReason: 'expired_id_rt_present',
          censusSeen: 2,
          censusHasRt: true,
          censusTokenFailureCount: '3',
        })
      )
    })

    it('page_diagnostic_does_not_overwrite_msal_census_on_closed_early', async () => {
      const { reportAnomaly, SyncPhase } = await import('../services/syncEventLog.js')
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      fireMessage({
        type: 'costco-webview-fetch-debug',
        message: 'msal-census',
        data: {
          reason: 'expired_id_rt_present',
          tokenFailureCount: '1',
          ls: {
            seen: 2,
            idTokens: 1,
            expired: 1,
            hasUsableRt: true,
            environments: 'signin.costco.com',
          },
          ss: { seen: 0 },
        },
      })
      fireMessage({
        type: 'costco-webview-fetch-debug',
        message: 'page-diagnostic',
        data: { lsLen: 99, ssLen: 35, lsKeys: [], ssKeys: [] },
      })
      fireClose()
      await expect(p).rejects.toThrow(/closed before tokens/i)
      expect(reportAnomaly).toHaveBeenCalledWith(
        'costco',
        SyncPhase.CLOSED_EARLY,
        expect.objectContaining({
          censusReason: 'expired_id_rt_present',
          censusHasRt: true,
        })
      )
      expect(reportAnomaly).not.toHaveBeenCalledWith(
        'costco',
        SyncPhase.CLOSED_EARLY,
        expect.objectContaining({ censusReason: 'page-diagnostic' })
      )
    })

    it('logs close_confirmed when closeEvent fires during verification', async () => {
      const { logPhase, SyncPhase } = await import('../services/syncEventLog.js')
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      await completeBridgeFlow(p, costcoTokensMessage, { confirmClose: true })
      expect(logPhase).toHaveBeenCalledWith(
        'costco',
        SyncPhase.CLOSE_CONFIRMED,
        expect.objectContaining({ mode: 'login' })
      )
      expect(syncLogMocks.reportAnomaly).not.toHaveBeenCalledWith(
        'costco',
        SyncPhase.CLOSE_UNCONFIRMED,
        expect.anything()
      )
    })
  })

  describe('group I — WebView instance scoping', () => {
    it('login success removes url and close listeners immediately', async () => {
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      await completeBridgeFlow(p)
      await vi.advanceTimersByTimeAsync(1500)
      expectSessionListenersCleared()
    })

    it('closeEvent without id still ends login when user dismisses early', async () => {
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      fireClose(undefined)
      await expect(p).rejects.toThrow(/WebView closed before tokens/)
    })

    it('drops foreign instance message events', async () => {
      const { startSilentSync } = await import('../services/costcoWebViewBridge.js')
      const silentPromise = startSilentSync()
      await vi.waitFor(() => expect(InAppBrowser.openWebView).toHaveBeenCalled())
      await Promise.resolve()
      InAppBrowser.close.mockClear()
      fireMessage(
        { type: 'costco-webview-fetch-debug', message: 'script_run', data: { reset: true } },
        'foreign-wv-id'
      )
      await vi.waitFor(() => {
        expect(InAppBrowser.close).toHaveBeenCalledWith({ id: 'foreign-wv-id' })
      })
      await vi.advanceTimersByTimeAsync(45_000)
      await silentPromise
    })

    it('passes latched id to executeScript after openWebView', async () => {
      const { startLogin } = await import('../services/costcoWebViewBridge.js')
      const p = startLogin()
      await flushUntilListenersReady()
      fireUrlChange('https://www.costco.com/')
      await vi.waitFor(() => InAppBrowser.executeScript.mock.calls.length > 0)
      const withId = InAppBrowser.executeScript.mock.calls.filter((c) => c[0]?.id)
      expect(withId.length).toBeGreaterThan(0)
      p.catch(() => {})
    })

    it('LOGIN_PREEMPTS_SILENT closes silent latched instance', async () => {
      const { startLogin, startSilentSync } = await import('../services/costcoWebViewBridge.js')
      const silentPromise = startSilentSync()
      await vi.waitFor(() => expect(InAppBrowser.openWebView).toHaveBeenCalledTimes(1))
      await Promise.resolve()
      const silentId = ibState.activeWebViewId
      InAppBrowser.close.mockClear()
      const loginPromise = startLogin()
      await expect(silentPromise).resolves.toEqual({ _skipped: true, reason: 'preempted' })
      expect(InAppBrowser.close).toHaveBeenCalledWith({ id: silentId })
      await flushUntilListenersReady()
      fireMessage(costcoTokensMessage)
      await completeBridgeFlow(loginPromise)
    })

    it('latch_timeout allows unscoped executeScript after 2s without events', async () => {
      InAppBrowser.openWebView.mockImplementationOnce(() => Promise.resolve({}))
      const { startSilentSync } = await import('../services/costcoWebViewBridge.js')
      const silentPromise = startSilentSync()
      await vi.waitFor(() => expect(InAppBrowser.openWebView).toHaveBeenCalled())
      await vi.advanceTimersByTimeAsync(2000)
      await vi.waitFor(() => InAppBrowser.executeScript.mock.calls.length > 0)
      const unscoped = InAppBrowser.executeScript.mock.calls.some((c) => !c[0]?.id)
      expect(unscoped).toBe(true)
      await vi.advanceTimersByTimeAsync(45_000)
      await silentPromise
    })
  })

  describe('group J — silent open gate', () => {
    it('SILENT_OPEN_GATE — no inject or s3_smash before openWebView resolves', async () => {
      const prevDevSettings = import.meta.env.VITE_ENABLE_DEV_SETTINGS
      import.meta.env.VITE_ENABLE_DEV_SETTINGS = '1'
      const ls = makeBrowserStorage()
      ls.setItem('COSTCO_S3_SMASH_RT', '1')
      vi.stubGlobal('localStorage', ls)

      let resolveOpen
      const openPromise = new Promise((resolve) => {
        resolveOpen = resolve
      })
      InAppBrowser.openWebView.mockImplementationOnce(() => {
        const id = `test-wv-deferred-${Date.now()}`
        ibState.activeWebViewId = id
        return openPromise
      })

      const { startSilentSync } = await import('../services/costcoWebViewBridge.js')
      const { postDevLog } = await import('../services/apiClient.js')
      const silentPromise = startSilentSync()
      await vi.waitFor(() => expect(InAppBrowser.openWebView).toHaveBeenCalled())

      fireUrlChange('https://www.costco.com/')
      await Promise.resolve()
      expect(InAppBrowser.executeScript).not.toHaveBeenCalled()
      expect(postDevLog).not.toHaveBeenCalledWith('costcoSilent', 's3_smash consumed=1')

      resolveOpen({ id: ibState.activeWebViewId })
      await Promise.resolve()
      await vi.waitFor(() => InAppBrowser.executeScript.mock.calls.length > 0)
      await vi.waitFor(() =>
        expect(postDevLog).toHaveBeenCalledWith('costcoSilent', 's3_smash consumed=1')
      )
      const smashCall = InAppBrowser.executeScript.mock.calls.find((c) =>
        String(c[0]?.code || '').includes('s3-smash-rt')
      )
      expect(smashCall).toBeDefined()

      await vi.advanceTimersByTimeAsync(45_000)
      await silentPromise
      import.meta.env.VITE_ENABLE_DEV_SETTINGS = prevDevSettings
    })

    it('SILENT_OPEN_GATE — 5s fallback injects when openWebView never resolves', async () => {
      InAppBrowser.openWebView.mockImplementationOnce(() => {
        const id = `test-wv-hung-${Date.now()}`
        ibState.activeWebViewId = id
        return new Promise(() => {})
      })
      const { startSilentSync } = await import('../services/costcoWebViewBridge.js')
      const silentPromise = startSilentSync()
      await vi.waitFor(() => expect(InAppBrowser.openWebView).toHaveBeenCalled())
      fireUrlChange('https://www.costco.com/')
      await vi.advanceTimersByTimeAsync(5000)
      await vi.waitFor(() => InAppBrowser.executeScript.mock.calls.length > 0)
      await vi.advanceTimersByTimeAsync(45_000)
      await silentPromise
    })
  })
})
