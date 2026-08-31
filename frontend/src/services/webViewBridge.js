/**
 * Generic WebView bridge factory for grocery provider token extraction and receipt fetch.
 * Extracts shared InAppBrowser lifecycle, message handling, and token storage.
 */

import { Capacitor } from '@capacitor/core';
import { InAppBrowser, ToolBarType } from '@capgo/inappbrowser';

const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_SILENT_TIMEOUT_MS = 45_000;
const DEFAULT_EXTRACT_INTERVAL_MS = 3000;
const LOGIN_IDLE_WATCHDOG_MS = 45_000;

import { getEffectiveApiBaseUrl } from './apiClient';
import { isAppForeground, onAppBackground, onAppForeground } from './appForeground';
import {
  beginSyncAttempt,
  getActiveSyncId,
  logPhase,
  reportAnomaly,
  SyncPhase,
} from './syncEventLog';
import {
  claimIfNew,
  claimInstance,
  closeInstanceById,
  getBelievedOpen,
  getEventInstanceId,
  getSessionInstanceId,
  isWebViewInstrumentationEnabled,
  markWebViewOpening,
  noteId,
  releaseInstanceSession,
  reapKnownUnowned,
  snapshotIds,
} from './webViewInstances';

export { getEventInstanceId } from './webViewInstances';

const INSTANCE_LATCH_TIMEOUT_MS = 2000;
/** Fallback if openWebView never resolves but page events arrive (slow devices). */
const SILENT_OPEN_READY_FALLBACK_MS = 5000;

const BRIDGE_LOG_MSG_MAX = 3800;

/** Per-session nonce injected into Costco page context to reset stale __costco* latches. */
function makeSyncNonce() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `sync-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getDevLogUrl() {
  try {
    const base = getEffectiveApiBaseUrl().url.replace(/\/+$/, '');
    return `${base}/dev/log`;
  } catch {
    return 'http://localhost:5000/api/dev/log';
  }
}

function bridgeDevLog(tag, msg) {
  try {
    const safeTag = String(tag || 'WebViewBridge').replace(/\s+/g, '_').slice(0, 64);
    let safeMsg = String(msg ?? '');
    if (safeMsg.length > BRIDGE_LOG_MSG_MAX) safeMsg = safeMsg.slice(0, BRIDGE_LOG_MSG_MAX) + '…';
    fetch(getDevLogUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: `${safeTag}|${safeMsg}`,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

/**
 * Flatten msal-census debug payloads into scalar fields for sync_events metadata.
 * page-diagnostic is supported for unit tests only; the bridge records msal-census only.
 * @param {{ message?: string, data?: Record<string, unknown> }} d
 * @returns {Record<string, string | number | boolean> | null}
 */
export function flattenCensusFromDebugMessage(d) {
  const data = d?.data;
  if (!data || typeof data !== 'object') return null;
  if (d.message === 'msal-census') {
    const ls = data.ls && typeof data.ls === 'object' ? data.ls : {};
    const ss = data.ss && typeof data.ss === 'object' ? data.ss : {};
    const envParts = [ls.environments, ss.environments].filter(Boolean);
    return {
      censusReason: String(data.reason || '').slice(0, 200),
      censusSeen: (Number(ls.seen) || 0) + (Number(ss.seen) || 0),
      censusIdTokens: (Number(ls.idTokens) || 0) + (Number(ss.idTokens) || 0),
      censusExpired: (Number(ls.expired) || 0) + (Number(ss.expired) || 0),
      censusHasRt: Boolean(ls.hasUsableRt || ss.hasUsableRt),
      censusEnvs: envParts.join(',').slice(0, 200),
      censusTokenFailureCount:
        data.tokenFailureCount != null ? String(data.tokenFailureCount).slice(0, 200) : '',
    };
  }
  if (d.message === 'page-diagnostic') {
    return {
      censusReason: 'page-diagnostic',
      censusSeen: (Number(data.lsLen) || 0) + (Number(data.ssLen) || 0),
      censusIdTokens: 0,
      censusExpired: 0,
      censusHasRt: false,
      censusEnvs: '',
      censusTokenFailureCount: '',
    };
  }
  if (d.message === 'diag-checkpoint') {
    if (data.checkpoint === 'purge-expired') {
      return {
        checkpoint: 'purge-expired',
        censusReason: 'purge-expired',
        purgeRemovedCount: Number(data.removedCount) || 0,
        censusSeen: 0,
        censusIdTokens: 0,
        censusExpired: 0,
        censusHasRt: false,
        censusEnvs: '',
        censusTokenFailureCount: '',
      };
    }
    const ls = data.ls && typeof data.ls === 'object' ? data.ls : {};
    const ss = data.ss && typeof data.ss === 'object' ? data.ss : {};
    const envParts = [ls.environments, ss.environments].filter(Boolean);
    const minLeft = [ls.minSecondsLeft, ss.minSecondsLeft]
      .filter((v) => v != null && !Number.isNaN(Number(v)))
      .map(Number);
    const maxLeft = [ls.maxSecondsLeft, ss.maxSecondsLeft]
      .filter((v) => v != null && !Number.isNaN(Number(v)))
      .map(Number);
    return {
      checkpoint: String(data.checkpoint || '').slice(0, 20),
      censusReason: `checkpoint-${String(data.checkpoint || '').slice(0, 20)}`,
      censusSeen: (Number(ls.seen) || 0) + (Number(ss.seen) || 0),
      censusIdTokens: (Number(ls.idTokens) || 0) + (Number(ss.idTokens) || 0),
      censusAccessTokens: (Number(ls.accessTokens) || 0) + (Number(ss.accessTokens) || 0),
      censusExpired: (Number(ls.expired) || 0) + (Number(ss.expired) || 0),
      censusHasRt: Boolean(ls.hasUsableRt || ss.hasUsableRt),
      censusEnvs: envParts.join(',').slice(0, 200),
      censusTfp: String(ls.tfp || ss.tfp || '').slice(0, 120),
      censusMinSecondsLeft: minLeft.length ? Math.min(...minLeft) : null,
      censusMaxSecondsLeft: maxLeft.length ? Math.max(...maxLeft) : null,
      hashPresent: Boolean(data.hashPresent),
      censusTokenFailureCount:
        data.tokenFailureCount != null ? String(data.tokenFailureCount).slice(0, 200) : '',
    };
  }
  if (d.message === 'msal-tokens-found') {
    return {
      checkpoint: 'tokens-found',
      censusReason: 'tokens-found',
      tfp: String(data.tfp || '').slice(0, 120),
      idSecondsLeft:
        data.idSecondsLeft != null && !Number.isNaN(Number(data.idSecondsLeft))
          ? Number(data.idSecondsLeft)
          : null,
      accSecondsLeft:
        data.accSecondsLeft != null && !Number.isNaN(Number(data.accSecondsLeft))
          ? Number(data.accSecondsLeft)
          : null,
      hasAccess: Boolean(data.hasAccess),
      hasRt: Boolean(data.hasRt),
    };
  }
  if (d.message === 'token-exchange') {
    return {
      tokenFired: Boolean(data.fired),
      tokenStatus: Number(data.status) || 0,
      tokenPolicy: String(data.policy || '').slice(0, 120),
      tokenError: String(data.error || '').slice(0, 80),
      tokenErrorDescription: String(data.errorDescription || '').slice(0, 200),
      tokenSource: String(data.source || '').slice(0, 32),
      tokenSweepRuns: Number(data.sweepRuns) || 0,
    };
  }
  if (d.message === 'rt-refresh-start' || d.message === 'rt-refresh-result') {
    return {
      censusReason: String(d.message || '').slice(0, 40),
      rtRefreshStatus: Number(data.status) || 0,
      rtRefreshCors: Boolean(data.cors),
      rtRefreshErrorCode: String(data.errorCode || '').slice(0, 80),
      rtRefreshPolicy: String(data.policy || '').slice(0, 120),
      rtRefreshHasNewId: Boolean(data.hasNewId),
      rtRefreshRotated: Boolean(data.rotated),
      rtRefreshSource: String(data.source || '').slice(0, 16),
    };
  }
  return null;
}

function anomalyMetadataWithCensus(base, summary, capturedAtMs) {
  if (!summary) return base;
  const ageMs = capturedAtMs ? Math.max(0, Date.now() - capturedAtMs) : 0;
  return { ...base, ...summary, censusAgeMs: ageMs };
}

/** Keep sync_events metadata within backend limits (10 keys, 1024 bytes). */
function pickSyncMetadata(flat, maxKeys = 10) {
  if (!flat || typeof flat !== 'object') return {};
  const priority = [
    'checkpoint',
    'censusSeen',
    'censusIdTokens',
    'censusAccessTokens',
    'censusExpired',
    'censusHasRt',
    'censusTfp',
    'tfp',
    'idSecondsLeft',
    'accSecondsLeft',
    'hasAccess',
    'hasRt',
    'censusTokenFailureCount',
    'censusMinSecondsLeft',
    'hashPresent',
    'purgeRemovedCount',
    'tokenFired',
    'tokenStatus',
    'tokenPolicy',
    'tokenError',
    'tokenErrorDescription',
    'tokenSource',
    'tokenSweepRuns',
  ];
  const out = {};
  for (const key of priority) {
    const value = flat[key];
    if (value == null || value === '') continue;
    out[key] = value;
    if (Object.keys(out).length >= maxKeys) break;
  }
  return out;
}

/**
 * Close the WebView. Retries up to 3 times with 300ms delay.
 * @param {string | null | undefined} instanceId - Capgo webview id when known
 * @returns {Promise<boolean>} true if close() succeeded
 */
async function closeWebView(logPrefix, provider, mode, syncId, instanceId) {
  const closeOpts = instanceId ? { id: instanceId } : {};
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await InAppBrowser.close(closeOpts);
      console.log(`${logPrefix} WebView closed (attempt ${attempt})`);
      return true;
    } catch (err) {
      console.warn(`${logPrefix} close attempt ${attempt} failed:`, err?.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 300));
    }
  }
  if (provider) {
    void reportAnomaly(provider, SyncPhase.CLOSE_FAILED, {
      mode,
      syncId: syncId || getActiveSyncId(provider),
      reason: 'close_api_failed',
    });
  }
  return false;
}

/** Process-wide InAppBrowser owner — Costco and Safeway share one native WebView. */
let activeSession = null;
let nextSessionId = 1;
/** Suppress superseded-session rejections during emergency teardown (tests / manual clear). */
let forceReleasing = false;

/**
 * @param {{ mode: 'login'|'silent', provider: string, abort?: () => void }} opts
 * @returns {{ ok: true, id: number } | { ok: false }}
 */
function tryBeginSession({ mode, provider, abort }) {
  if (!activeSession) {
    const id = nextSessionId++;
    activeSession = { id, mode, provider, abort: abort ?? (() => {}) };
    return { ok: true, id };
  }
  if (mode === 'silent') {
    return { ok: false };
  }
  const prev = activeSession;
  activeSession = null;
  try {
    prev.abort?.();
  } catch {
    /* ignore */
  }
  const id = nextSessionId++;
  activeSession = { id, mode, provider, abort: abort ?? (() => {}) };
  return { ok: true, id };
}

function endSession(id) {
  if (activeSession?.id === id) {
    activeSession = null;
  }
}

function isSessionOwner(id) {
  return activeSession?.id === id;
}

async function closeIfOwner(id, logPrefix, provider, mode, instanceId) {
  if (isSessionOwner(id)) {
    await closeWebView(logPrefix, provider, mode, getActiveSyncId(provider), instanceId);
  } else if (provider) {
    void reportAnomaly(provider, SyncPhase.CLOSE_SKIPPED_NOT_OWNER, {
      mode,
      syncId: getActiveSyncId(provider),
      reason: 'session_ownership_lost',
      metadata: { session_id: id },
    });
  }
}

/**
 * Request WebView close and verify closeEvent (detect-only).
 * @param {string | null | undefined} instanceId
 */
async function closeBrowserForSession(sessionId, logPrefix, provider, mode, instanceId) {
  const syncId = getActiveSyncId(provider);
  const detail = { mode, syncId, metadata: { session_id: sessionId } };

  if (sessionId != null && !isSessionOwner(sessionId)) {
    void reportAnomaly(provider, SyncPhase.CLOSE_SKIPPED_NOT_OWNER, {
      ...detail,
      reason: 'session_ownership_lost',
    });
    return;
  }

  let closeConfirmed = false;
  let verifyListener = null;
  try {
    verifyListener = await InAppBrowser.addListener('closeEvent', (event) => {
      const eid = getEventInstanceId(event);
      if (!instanceId || !eid || eid === instanceId) {
        closeConfirmed = true;
      }
    });
  } catch {
    /* ignore */
  }

  void logPhase(provider, SyncPhase.CLOSE_REQUESTED, detail);

  const closed = await closeWebView(logPrefix, provider, mode, syncId, instanceId);
  await Promise.race([
    new Promise((resolve) => {
      if (closeConfirmed) {
        resolve();
        return;
      }
      const check = setInterval(() => {
        if (closeConfirmed) {
          clearInterval(check);
          resolve();
        }
      }, 50);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 3000);
    }),
  ]);
  verifyListener?.remove?.();

  if (!closed) {
    return;
  }
  if (closeConfirmed) {
    void logPhase(provider, SyncPhase.CLOSE_CONFIRMED, detail);
  } else {
    void reportAnomaly(provider, SyncPhase.CLOSE_UNCONFIRMED, {
      ...detail,
      reason: 'no_close_event',
    });
  }
}

async function prepareWebViewSessionStart(provider, mode) {
  await reapKnownUnowned('pre_session', provider, mode);
  if (getBelievedOpen()) {
    await InAppBrowser.close().catch(() => {});
  }
}

/**
 * Per-session InAppBrowser instance latch (see webViewInstances.js).
 * @param {number} sessionId
 * @param {string} logTag
 * @param {string} provider
 * @param {'login'|'silent'} mode
 */
function createInstanceLatch(sessionId, logTag, provider, mode) {
  let latchedId = getSessionInstanceId(sessionId) || null;
  let preSnapshot = new Set();
  let latchTimedOut = false;
  let foreignSeen = false;
  let claimFrozen = false;
  let latchTimer = null;

  const clearLatchTimer = () => {
    if (latchTimer != null) {
      clearTimeout(latchTimer);
      latchTimer = null;
    }
  };

  const logBridgeEvent = (eventName, event) => {
    if (!isWebViewInstrumentationEnabled()) return;
    const eid = getEventInstanceId(event);
    bridgeDevLog(
      logTag,
      `evt ${eventName} id=${eid ? eid.slice(0, 12) : 'none'} latched=${latchedId ? latchedId.slice(0, 12) : 'none'}`
    );
  };

  const closeForeignId = (eventId) => {
    foreignSeen = true;
    bridgeDevLog(
      logTag,
      `foreign_instance drop=${eventId.slice(0, 8)} latched=${latchedId ? latchedId.slice(0, 8) : 'pending'}`
    );
    void closeInstanceById(eventId).then((closed) => {
      if (closed) {
        const rowAge = 0;
        void logPhase(provider, SyncPhase.WEBVIEW_ORPHAN_CLOSED, {
          mode,
          reason: 'foreign_event',
          metadata: { instanceAgeMs: rowAge },
        });
      }
    });
  };

  const tryLatchEventId = (eventId) => {
    if (claimFrozen || latchTimedOut || !eventId || latchedId) return;
    noteId(eventId);
    if (preSnapshot.has(eventId)) return;
    if (claimIfNew(sessionId, eventId, preSnapshot)) {
      latchedId = eventId;
      clearLatchTimer();
    }
  };

  return {
    takePreOpenSnapshot() {
      preSnapshot = snapshotIds();
    },
    latchFromOpenResult(result) {
      if (claimFrozen) return latchedId;
      const id = result?.id;
      if (id && typeof id === 'string') {
        claimInstance(sessionId, id);
        latchedId = id;
        noteId(id);
        clearLatchTimer();
      }
      return latchedId;
    },
    acceptInstanceEvent(eventName, event) {
      logBridgeEvent(eventName, event);
      const eventId = getEventInstanceId(event);
      if (!eventId) return true;
      noteId(eventId);
      if (!claimFrozen && !latchedId && !latchTimedOut) {
        if (preSnapshot.has(eventId)) {
          closeForeignId(eventId);
          return false;
        }
        tryLatchEventId(eventId);
      }
      if (latchedId && eventId !== latchedId) {
        closeForeignId(eventId);
        return false;
      }
      if (!latchedId && preSnapshot.has(eventId)) {
        closeForeignId(eventId);
        return false;
      }
      return true;
    },
    scheduleLatchTimeout(onTimeout) {
      clearLatchTimer();
      latchTimer = setTimeout(() => {
        if (!latchedId) {
          latchTimedOut = true;
          bridgeDevLog(logTag, 'latch_timeout');
          onTimeout?.();
        }
      }, INSTANCE_LATCH_TIMEOUT_MS);
    },
    freezeClaim() {
      claimFrozen = true;
    },
    scriptOpts(code) {
      if (latchedId) return { code, id: latchedId };
      if (latchTimedOut) return { code };
      return null;
    },
    canInject() {
      return latchedId != null || latchTimedOut;
    },
    getLatchedId() {
      return latchedId;
    },
    hadForeignInstance() {
      return foreignSeen;
    },
    release() {
      clearLatchTimer();
      releaseInstanceSession(sessionId);
      latchedId = null;
    },
    async closeLatched() {
      clearLatchTimer();
      const id = latchedId;
      if (id) {
        await closeInstanceById(id);
      } else if (getBelievedOpen()) {
        await InAppBrowser.close().catch(() => {});
      }
    },
    clearLatchTimer,
  };
}

/** Abort in-flight session hooks and clear ownership (emergency / session clear). */
export function forceReleaseWebViewSession() {
  forceReleasing = true;
  try {
    if (activeSession) {
      try {
        activeSession.abort?.();
      } catch {
        /* ignore */
      }
      activeSession = null;
    }
  } finally {
    forceReleasing = false;
  }
}

/** @returns {{ mode: 'login'|'silent', provider: string } | null} */
export function getActiveWebViewSession() {
  if (!activeSession) return null;
  return { mode: activeSession.mode, provider: activeSession.provider };
}

/**
 * Create a WebView bridge for a grocery provider.
 *
 * @param {Object} config
 * @param {string} config.provider - Provider name (e.g. 'costco', 'safeway')
 * @param {string} config.loginUrl - URL to open for login
 * @param {string} config.homeUrl - URL for silent sync
 * @param {string[]} config.extractDomains - Domains where extraction runs
 * @param {() => string} config.getExtractScript - Returns IIFE script string
 * @param {{ receipts: string, tokens: string, debug?: string, tokenRotated?: string, silentUnrecoverable?: string, appRefreshRequest?: string }} config.messageTypes
 * @param {Object} config.tokenStorage - createTokenStorage() instance
 * @param {(d: any) => Object} config.extractTokensFromReceiptsMessage - Maps receipts message to storage values
 * @param {(d: any) => Object} config.extractTokensFromTokensMessage - Maps tokens message to storage values
 * @param {(d: any) => any[]} config.extractRawReceipts - Extracts raw receipts array from message
 * @param {(raw: any[]) => any[]} config.parseReceipts - Parses raw receipts to backend format
 * @param {(raw: any[]) => any[]} [config.filterReceipts] - Optional pre-parse filter
 * @param {number} [config.loginTimeoutMs]
 * @param {number} [config.silentTimeoutMs]
 * @param {number} [config.extractIntervalMs]
 * @param {string} [config.loginTitle] - WebView title for login
 * @param {string} [config.urlExcludePattern] - URL pattern to exclude from extraction trigger (e.g. '/LogonForm')
 * @param {string[]} [config.skipInjectionUrlPatterns] - Substrings when present in WebView URL skip executeScript extraction (Costco login: signin/Azure/B2C)
 * @param {Object} [config.httpOnlyCookies] - Optional HttpOnly cookie extraction: { url, cookieName, parseToken, injectKey, injectVarName }
 * @param {() => string} [config.preExtractVars] - Optional JS snippet to inject before extract script (e.g. window.__knownOrderIds=...)
 * @param {() => string|null|undefined} [config.silentPreExtractVars] - Silent-only prepend concatenated into the same executeScript as extract (e.g. S3 smash); not run on login
 * @param {string} [config.interactiveUnrecoverableScript] - Login-only: inject once on costco-silent-unrecoverable (wipe dead MSAL + reload)
 * @param {() => Promise<string|undefined>} [config.extractCookiesBeforeClose] - Optional: read cookies from InAppBrowser before close (e.g. for native API Cookie header)
 * @param {Object} [config.loopDetection] - Optional login redirect-loop detector: { loopUrlPattern, resetUrlPatterns, threshold, windowMs, errorMessage, authCompletePatterns, postAuthThreshold, postAuthWindowMs, postAuthErrorMessage }
 * @param {string} [config.diagnosticInjectScript] - Read-only JS snippet injected once per host on urlChange (bypasses skipInjection)
 * @param {object} [config.diagnosticProbe] - Automated checkpoint census + /token capture (Costco Run A/B)
 * @param {{ urlPatterns: string[], cookieUrls: string[] }} [config.cookieProbe] - Native getCookies probe at matching URLs (logs key names only)
 * @param {() => Promise<{ idToken: string, refreshToken?: string, refreshTokenClientId?: string } | null>} [config.silentAppRefresh] - App-side B2C grant when page requests refresh (CORS / no page RT)
 * @param {(err: Error) => boolean} [config.isTerminalAppRefreshError] - When silentAppRefresh fails, only finish needs_reconnect if this returns true
 */
export function normalizeWebViewMessageDetail(event) {
  let d = event?.detail;
  if (typeof d === 'string' && d.length > 0) {
    try {
      const parsed = JSON.parse(d);
      d = parsed?.detail ?? parsed;
    } catch {
      return null;
    }
  }
  if (!d || typeof d !== 'object') return null;
  if (d.type != null && String(d.type).length > 0) return d;
  const raw = d.rawMessage;
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const inner = parsed.detail ?? parsed;
        if (inner && typeof inner === 'object') return inner;
      }
    } catch {
      /* legacy JSON-string postMessage body */
    }
  }
  return d;
}

export function evaluateLoginLoopDetection(url, loopDetection, state) {
  if (!loopDetection || !url) {
    return { tripped: false, hits: state?.loopHits ?? 0, reason: null };
  }
  const {
    loopUrlPattern,
    resetUrlPatterns = [],
    threshold,
    windowMs,
    errorMessage,
    authCompletePatterns = [],
    postAuthThreshold,
    postAuthWindowMs,
    postAuthErrorMessage,
  } = loopDetection;
  const now = Date.now();
  if (!state.loopWindowStart) state.loopWindowStart = now;
  if (!state.postAuthWindowStart) state.postAuthWindowStart = now;

  if (authCompletePatterns.length && authCompletePatterns.some((p) => url.includes(p))) {
    state.authComplete = true;
    state.postAuthHits = 0;
    state.postAuthWindowStart = now;
  }

  if (resetUrlPatterns.some((p) => url.includes(p))) {
    state.loopHits = 0;
    state.loopWindowStart = now;
  }

  const matchesLoop =
    loopUrlPattern instanceof RegExp ? loopUrlPattern.test(url) : url.includes(String(loopUrlPattern));
  if (!matchesLoop) {
    return {
      tripped: false,
      hits: state.authComplete ? (state.postAuthHits ?? 0) : (state.loopHits ?? 0),
      reason: null,
    };
  }

  if (
    state.authComplete &&
    postAuthThreshold != null &&
    postAuthWindowMs != null &&
    postAuthErrorMessage
  ) {
    if (now - state.postAuthWindowStart > postAuthWindowMs) {
      state.postAuthWindowStart = now;
      state.postAuthHits = 0;
    }
    state.postAuthHits = (state.postAuthHits ?? 0) + 1;
    const tripped = state.postAuthHits >= postAuthThreshold;
    return {
      tripped,
      hits: state.postAuthHits,
      reason: tripped ? 'post-auth' : null,
      errorMessage: tripped ? postAuthErrorMessage : undefined,
    };
  }

  if (now - state.loopWindowStart > windowMs) {
    state.loopWindowStart = now;
    state.loopHits = 0;
  }
  state.loopHits = (state.loopHits ?? 0) + 1;
  const tripped = state.loopHits >= threshold;
  return {
    tripped,
    hits: state.loopHits,
    reason: tripped ? 'pre-auth' : null,
    errorMessage: tripped ? errorMessage : undefined,
  };
}

function pickRtRefreshTelemetryMeta(data) {
  if (!data || typeof data !== 'object') return {};
  const out = {};
  if (typeof data.status === 'number') out.status = data.status;
  if (data.policy) out.policy = String(data.policy).slice(0, 64);
  if (data.tenant) out.tenant = String(data.tenant).slice(0, 16);
  if (data.authoritySource) out.authoritySource = String(data.authoritySource).slice(0, 16);
  if (typeof data.attempt === 'number') out.attempt = data.attempt;
  if (data.errorCode) out.errorCode = String(data.errorCode).slice(0, 80);
  return out;
}

function logRtRefreshExchange(provider, mode, data) {
  if (!data || typeof data !== 'object') return;
  const status = data.status;
  if (status === 200 && data.hasNewId) return;
  const reason = data.errorCode
    ? String(data.errorCode).slice(0, 120)
    : status
      ? `http_${status}`
      : data.cors
        ? 'cors'
        : 'network';
  void logPhase(provider, SyncPhase.TOKEN_EXCHANGE, {
    mode,
    reason,
    metadata: pickRtRefreshTelemetryMeta(data),
  });
}

export function createWebViewBridge(config) {
  const {
    provider,
    loginUrl,
    homeUrl,
    extractDomains,
    getExtractScript,
    messageTypes,
    tokenStorage,
    extractTokensFromReceiptsMessage,
    extractTokensFromTokensMessage,
    extractRawReceipts,
    parseReceipts,
    filterReceipts,
    loginTimeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
    silentTimeoutMs = DEFAULT_SILENT_TIMEOUT_MS,
    extractIntervalMs = DEFAULT_EXTRACT_INTERVAL_MS,
    loginTitle = `Sign in to ${provider}`,
    urlExcludePattern = '',
    skipInjectionUrlPatterns = [],
    httpOnlyCookies,
    preExtractVars,
    silentPreExtractVars,
    extractInstrumentationPrefix,
    interactiveUnrecoverableScript,
    extractCookiesBeforeClose,
    loopDetection,
    diagnosticInjectScript,
    diagnosticProbe,
    cookieProbe,
    clearSessionBeforeLogin,
    silentAppRefresh,
    isTerminalAppRefreshError,
  } = config;

  const LOG_PREFIX = `[${provider}WebViewBridge]`;
  const EXTRACT_SCRIPT = getExtractScript();

  const isExtractUrl = (url) => {
    if (!url) return false;
    if (urlExcludePattern && url.includes(urlExcludePattern)) return false;
    return extractDomains.some((d) => url.includes(d));
  };

  const shouldSkipInjectionForUrl = (url) => {
    if (!url || !skipInjectionUrlPatterns.length) return false;
    return skipInjectionUrlPatterns.some((p) => url.includes(p));
  };

  /** For logging Akamai/https diagnostics (blocked URLs still report https in practice). */
  const logUrlScheme = (prefix, url) => {
    if (!url) return;
    const isHttps = url.startsWith('https:');
    const schemeHint = isHttps ? 'https' : url.startsWith('http:') ? 'http' : 'other';
    console.log(`${LOG_PREFIX} ${prefix} (${schemeHint}), len=${url.length}`);
  };

  const closeBrowserForSessionBound = (sessionId, mode, instanceId) =>
    closeBrowserForSession(sessionId, LOG_PREFIX, provider, mode, instanceId);

  const handleReceiptsMessage = async (d, finish, sessionId, mode, instanceId) => {
    void logPhase(provider, SyncPhase.RECEIPTS_RECEIVED, { mode });
    const rawReceipts = extractRawReceipts(d) ?? [];
    const filtered = filterReceipts ? filterReceipts(rawReceipts) : rawReceipts;
    const receipts = parseReceipts(Array.isArray(filtered) ? filtered : []).filter(Boolean);
    const tokens = extractTokensFromReceiptsMessage(d);

    await closeBrowserForSessionBound(sessionId, mode, instanceId);
    await tokenStorage.store(tokens);

    finish({
      ...tokens,
      receipts,
      _fromWebView: true,
    });
  };

  const handleTokensMessage = async (d, finish, sessionId, mode, instanceId) => {
    void logPhase(provider, SyncPhase.TOKENS_RECEIVED, { mode });
    const tokens = extractTokensFromTokensMessage(d);
    let cookieHeader;
    if (extractCookiesBeforeClose) {
      cookieHeader = await extractCookiesBeforeClose().catch(() => undefined);
    }
    await closeBrowserForSessionBound(sessionId, mode, instanceId);
    await tokenStorage.store(tokens);
    finish({
      ...tokens,
      _closeWebViewAfterFetch: true,
      cookieHeader,
    });
  };

  return {
    async startLogin() {
      console.log(`${LOG_PREFIX} startLogin() called, platform=${Capacitor.getPlatform()}`);
      if (!Capacitor.isNativePlatform()) {
        throw new Error(`${provider} WebView bridge requires a native platform (iOS/Android)`);
      }

      beginSyncAttempt(provider, 'login');
      const loginMode = 'login';

      let messageListener;
      let closeListener;
      let urlListener;
      let pageLoadedListener;
      let tokensReceived = false;
      let progressReceived = false;
      let extractInterval;
      let timeoutHandle;
      let pendingGraceTimer = null;
      let idleWatchdogTimer = null;
      let loginAppRefreshAttempted = false;
      let loginStartedAt = Date.now();
      let loginSessionBackgroundMs = 0;
      let loginPausedAt = null;
      let unsubLoginBackground = null;
      let unsubLoginForeground = null;
      const finish = { resolve: null, reject: null };
      let sessionId = null;

      const loginState = { cleanup: null };

      const loginAbort = () => {
        void instanceLatch.closeLatched();
        instanceLatch.release();
        loginState.cleanup?.();
        if (!forceReleasing) {
          finish.reject?.(new Error('Login superseded by newer login'));
        }
        endSession(sessionId);
      };

      const sessionBegin = tryBeginSession({ mode: 'login', provider, abort: loginAbort });
      sessionId = sessionBegin.id;
      const loginNonce = makeSyncNonce();
      const loginLogTag = `${provider}Login`;
      const instanceLatch = createInstanceLatch(sessionId, loginLogTag, provider, loginMode);

      await prepareWebViewSessionStart(provider, loginMode);
      if (clearSessionBeforeLogin) {
        await InAppBrowser.clearAllCookies({}).catch(() => {});
        await InAppBrowser.clearCache({}).catch(() => {});
        bridgeDevLog(`${provider}Login`, 'pre-login session cleared');
      }

      let extractionAttempts = 0;
      let httpOnlyTokenInjected = false;
      /** Last URL from urlChangeEvent (diagnostics / bridge logging only). */
      let lastBrowserUrl = loginUrl;
      const loopState = {
        loopHits: 0,
        loopWindowStart: Date.now(),
        authComplete: false,
        postAuthHits: 0,
        postAuthWindowStart: Date.now(),
      };
      const diagnosticHostsInjected = new Set();
      const probePagesInstalled = new Set();
      let checkpointA0Done = false;
      let checkpointA1Done = false;
      let checkpointA2Done = false;
      let checkpointA3Done = false;
      let diagCheckpointLogged = 0;
      let diagCheckpointPersisted = 0;
      let tokenExchangeLogged = 0;
      let a2Timer = null;
      let a3Timer = null;
      let diagGraceTimer = null;
      let lastCensusSummary = null;
      let lastCensusAtMs = 0;
      let loginRebootstrapDone = false;
      const censusMeta = (base) =>
        anomalyMetadataWithCensus(base, lastCensusSummary, lastCensusAtMs);

      const scheduleLoginTimeout = () => {
        if (timeoutHandle != null) clearTimeout(timeoutHandle);
        if (!isAppForeground()) {
          timeoutHandle = null;
          return;
        }
        const elapsed = Date.now() - loginStartedAt - loginSessionBackgroundMs;
        const remaining = Math.max(0, loginTimeoutMs - elapsed);
        timeoutHandle = setTimeout(() => {
          if (tokensReceived) return;
          bridgeDevLog(
            loginLogTag,
            `login timeout ${loginTimeoutMs / 1000}s lastUrl=${(lastBrowserUrl || '').slice(0, 160)}`
          );
          console.warn(`${LOG_PREFIX} Login timeout (${loginTimeoutMs / 1000}s)`);
          void reportAnomaly(provider, SyncPhase.LOGIN_TIMEOUT, censusMeta({ mode: loginMode }));
          cleanupListeners();
          closeIfOwner(sessionId, LOG_PREFIX, provider, loginMode, instanceLatch.getLatchedId()).finally(() => {
            instanceLatch.release();
            endSession(sessionId);
          });
          finish.reject?.(
            new Error(
              `${provider} login timed out. Please try again and complete sign-in within ${Math.round(loginTimeoutMs / 60000)} minutes.`
            )
          );
        }, remaining);
      };

      const scheduleIdleWatchdog = () => {
        if (idleWatchdogTimer != null) clearTimeout(idleWatchdogTimer);
        if (tokensReceived) return;
        if (!isExtractUrl(lastBrowserUrl) || shouldSkipInjectionForUrl(lastBrowserUrl)) return;
        idleWatchdogTimer = setTimeout(() => {
          if (tokensReceived) return;
          bridgeDevLog(loginLogTag, 'idle watchdog: refresh stalled on extract url');
          void reportAnomaly(
            provider,
            SyncPhase.SYNC_FAILED,
            censusMeta({ mode: loginMode, reason: 'refresh_stalled' })
          );
          cleanupListeners();
          closeIfOwner(sessionId, LOG_PREFIX, provider, loginMode, instanceLatch.getLatchedId()).finally(() => {
            instanceLatch.release();
            endSession(sessionId);
          });
          finish.reject?.(
            new Error(
              'We could not refresh your Costco session. Sign out of Costco in this window and sign in again.'
            )
          );
        }, LOGIN_IDLE_WATCHDOG_MS);
      };

      const runLoginAppRefreshIfNeeded = async () => {
        if (loginAppRefreshAttempted || tokensReceived || !silentAppRefresh) return;
        loginAppRefreshAttempted = true;
        try {
          const refreshed = await silentAppRefresh();
          if (!refreshed?.idToken || tokensReceived) return;
          const code = `window.__mealdInjectedIdToken=${JSON.stringify(refreshed.idToken)};`;
          const opts = instanceLatch.scriptOpts(code);
          if (opts) await InAppBrowser.executeScript(opts).catch(() => {});
          runExtraction();
        } catch (err) {
          const isTerminal =
            typeof isTerminalAppRefreshError === 'function' && isTerminalAppRefreshError(err);
          if (isTerminal) {
            if (interactiveUnrecoverableScript && !loginRebootstrapDone) {
              loginRebootstrapDone = true;
              InAppBrowser.executeScript(
                instanceLatch.scriptOpts(interactiveUnrecoverableScript) || { code: interactiveUnrecoverableScript }
              ).catch(() => {});
            }
            return;
          }
          loginAppRefreshAttempted = false;
          bridgeDevLog(
            loginLogTag,
            `login app_refresh_transient ${(err?.message || err || '').toString().slice(0, 120)}`
          );
        }
      };

      unsubLoginBackground = onAppBackground(() => {
        if (tokensReceived) return;
        loginPausedAt = Date.now();
        if (timeoutHandle != null) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      });

      unsubLoginForeground = onAppForeground(() => {
        if (tokensReceived) return;
        if (loginPausedAt != null) {
          loginSessionBackgroundMs += Date.now() - loginPausedAt;
          loginPausedAt = null;
        }
        scheduleLoginTimeout();
      });

      if (diagnosticProbe?.onSessionStart) {
        diagnosticProbe.onSessionStart(getActiveSyncId(provider));
      }

      const runDiagnosticScript = (code) => {
        if (!code) return;
        const opts = instanceLatch.scriptOpts(code);
        if (!opts) return;
        InAppBrowser.executeScript(opts).catch(() => {});
      };

      const emitDiagnosticCheckpoint = (label) => {
        if (!diagnosticProbe || tokensReceived || diagCheckpointLogged >= 6) return;
        diagCheckpointLogged += 1;
        runDiagnosticScript(diagnosticProbe.getCheckpointScript?.(label));
      };

      const persistDiagnosticCheckpoint = (reason, flat, data, eventKind) => {
        if (diagCheckpointPersisted >= 6) return;
        diagCheckpointPersisted += 1;
        if (flat) {
          lastCensusSummary = flat;
          lastCensusAtMs = Date.now();
        }
        void logPhase(provider, SyncPhase.DIAGNOSTIC_CHECKPOINT, {
          mode: loginMode,
          reason,
          metadata: pickSyncMetadata(flat),
        });
        diagnosticProbe.onDiagnosticEvent?.(eventKind, data ?? {}, flat);
      };

      const installDiagnosticProbeForUrl = (u) => {
        if (!diagnosticProbe?.getInstallScript || tokensReceived) return;
        let pageKey = '';
        try {
          pageKey = new URL(u, loginUrl).href.split('#')[0];
        } catch {
          pageKey = String(u || '').split('#')[0];
        }
        if (!pageKey || probePagesInstalled.has(pageKey)) return;
        probePagesInstalled.add(pageKey);
        runDiagnosticScript(diagnosticProbe.getInstallScript());
      };

      const handleDiagnosticDebugMessage = (d) => {
        if (!diagnosticProbe) return false;
        if (d.message === 'msal-tokens-found') {
          const flat = flattenCensusFromDebugMessage(d);
          persistDiagnosticCheckpoint('tokens-found', flat, {
            checkpoint: 'tokens-found',
            ...d.data,
          }, 'diag-checkpoint');
          return true;
        }
        if (d.message !== 'diag-checkpoint' && d.message !== 'token-exchange') return false;
        const flat = flattenCensusFromDebugMessage(d);
        if (d.message === 'diag-checkpoint') {
          persistDiagnosticCheckpoint(
            d.data?.checkpoint != null ? String(d.data.checkpoint) : undefined,
            flat,
            d.data ?? {},
            'diag-checkpoint'
          );
        }
        if (d.message === 'token-exchange' && tokenExchangeLogged < 4) {
          tokenExchangeLogged += 1;
          const data = d.data && typeof d.data === 'object' ? d.data : {};
          const exchangeReason =
            data.source === 'missed' || !data.fired ? 'missed' : 'observed';
          void logPhase(provider, SyncPhase.TOKEN_EXCHANGE, {
            mode: loginMode,
            reason: exchangeReason,
            metadata: pickSyncMetadata(flat),
          });
          diagnosticProbe.onDiagnosticEvent?.('token-exchange', data, flat);
        }
        return true;
      };

      const beginTokenCleanupGrace = () => {
        instanceLatch.freezeClaim();
        if (extractInterval != null) {
          clearInterval(extractInterval);
          extractInterval = null;
        }
        if (timeoutHandle != null) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        closeListener?.remove?.();
        urlListener?.remove?.();
        pageLoadedListener?.remove?.();
        unsubLoginBackground?.();
        unsubLoginForeground?.();
        if (diagGraceTimer != null) {
          clearTimeout(diagGraceTimer);
        }
        diagGraceTimer = setTimeout(() => {
          diagGraceTimer = null;
          messageListener?.remove?.();
        }, 1500);
      };

      const runTokenVerdictThen = (next) => {
        const verdictCode = diagnosticProbe?.getVerdictScript?.();
        if (!verdictCode) {
          next();
          return;
        }
        InAppBrowser.executeScript(
          instanceLatch.scriptOpts(verdictCode) || { code: verdictCode }
        )
          .catch(() => {})
          .finally(() => next());
      };

      const runHttpOnlyCookiePoll = async () => {
        if (!httpOnlyCookies || tokensReceived || httpOnlyTokenInjected) return;
        try {
          const cookies = await InAppBrowser.getCookies({
            url: httpOnlyCookies.url,
            includeHttpOnly: true,
          });
          const raw = cookies?.[httpOnlyCookies.cookieName];
          if (!raw) return;
          const parsed = httpOnlyCookies.parseToken(raw);
          if (!parsed) return;
          const tokenValue = parsed[httpOnlyCookies.injectKey];
          if (!tokenValue) return;
          const escaped = JSON.stringify(tokenValue);
          const code = `window.${httpOnlyCookies.injectVarName}=${escaped};`;
          const opts = instanceLatch.scriptOpts(code);
          if (!opts) return;
          await InAppBrowser.executeScript(opts);
          httpOnlyTokenInjected = true;
          console.log(`${LOG_PREFIX} Injected HttpOnly token (${httpOnlyCookies.injectVarName})`);
        } catch (err) {
          console.warn(`${LOG_PREFIX} getCookies failed:`, err?.message || err);
        }
      };

      const runExtraction = () => {
        if (tokensReceived) return;
        if (shouldSkipInjectionForUrl(lastBrowserUrl)) {
          return;
        }
        extractionAttempts++;
        scheduleIdleWatchdog();
        runHttpOnlyCookiePoll().then(async () => {
          let code = `window.__mealdSyncNonce=${JSON.stringify(loginNonce)};`;
          if (extractInstrumentationPrefix) code += extractInstrumentationPrefix();
          if (preExtractVars) code += preExtractVars();
          code += EXTRACT_SCRIPT;
          const opts = instanceLatch.scriptOpts(code);
          if (!opts) return;
          InAppBrowser.executeScript(opts).catch((err) => {
            const em = err?.message || String(err);
            if (extractionAttempts <= 3 || extractionAttempts % 10 === 0) {
              console.warn(`${LOG_PREFIX} executeScript failed (attempt ${extractionAttempts}):`, em);
              bridgeDevLog(loginLogTag, `executeScript failed attempt=${extractionAttempts} lastUrl=${(lastBrowserUrl || '').slice(0, 160)} err=${em.slice(0, 200)}`);
            }
          });
        });
      };

      const cleanupListeners = () => {
        messageListener?.remove?.();
        closeListener?.remove?.();
        urlListener?.remove?.();
        pageLoadedListener?.remove?.();
        instanceLatch.clearLatchTimer();
        if (pendingGraceTimer != null) {
          clearTimeout(pendingGraceTimer);
          pendingGraceTimer = null;
        }
        if (a2Timer != null) {
          clearTimeout(a2Timer);
          a2Timer = null;
        }
        if (a3Timer != null) {
          clearTimeout(a3Timer);
          a3Timer = null;
        }
        if (diagGraceTimer != null) {
          clearTimeout(diagGraceTimer);
          diagGraceTimer = null;
          messageListener?.remove?.();
        }
        if (idleWatchdogTimer != null) {
          clearTimeout(idleWatchdogTimer);
          idleWatchdogTimer = null;
        }
        unsubLoginBackground?.();
        unsubLoginForeground?.();
        if (extractInterval != null) {
          clearInterval(extractInterval);
          extractInterval = null;
        }
        if (timeoutHandle != null) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      };

      const cleanup = () => {
        cleanupListeners();
        instanceLatch.release();
        endSession(sessionId);
      };
      loginState.cleanup = cleanup;

      try {
        messageListener = await InAppBrowser.addListener('messageFromWebview', (event) => {
          if (!instanceLatch.acceptInstanceEvent('messageFromWebview', event)) return;
          try {
            const d = normalizeWebViewMessageDetail(event);
            if (!d) return;
            if (d?.type === messageTypes.debug) {
              console.log(`${LOG_PREFIX} [WebView] ${d.message || ''}`, d.data ?? '');
              if (handleDiagnosticDebugMessage(d)) {
                try {
                  const payload = `${d.message || ''} ${JSON.stringify(d.data ?? {})}`;
                  bridgeDevLog(loginLogTag, `webview debug: ${payload}`);
                } catch {
                  bridgeDevLog(loginLogTag, `webview debug: ${d.message || ''}`);
                }
                return;
              }
              if (d.message === 'msal-census') {
                const flat = flattenCensusFromDebugMessage(d);
                if (flat) {
                  lastCensusSummary = flat;
                  lastCensusAtMs = Date.now();
                }
              }
              if (d.message === 'rt-refresh-start' || d.message === 'rt-refresh-result') {
                logRtRefreshExchange(provider, loginMode, d.data);
              }
              try {
                const payload = `${d.message || ''} ${JSON.stringify(d.data ?? {})}`;
                bridgeDevLog(loginLogTag, `webview debug: ${payload}`);
              } catch {
                bridgeDevLog(loginLogTag, `webview debug: ${d.message || ''}`);
              }
              return;
            }
            if (messageTypes.tokenRotated && d?.type === messageTypes.tokenRotated) {
              const tokens = extractTokensFromTokensMessage(d);
              tokenStorage.store(tokens).catch((err) => {
                console.warn(`${LOG_PREFIX} login token-rotated store failed`, err?.message || err);
              });
              return;
            }
            if (messageTypes.appRefreshRequest && d?.type === messageTypes.appRefreshRequest) {
              void runLoginAppRefreshIfNeeded();
              return;
            }
            if (messageTypes.silentUnrecoverable && d?.type === messageTypes.silentUnrecoverable) {
              bridgeDevLog(
                loginLogTag,
                `interactive unrecoverable reason=${String(d.reason || '').slice(0, 120)}`
              );
              if (interactiveUnrecoverableScript && !loginRebootstrapDone) {
                loginRebootstrapDone = true;
                InAppBrowser.executeScript(
                instanceLatch.scriptOpts(interactiveUnrecoverableScript) || { code: interactiveUnrecoverableScript }
              ).catch(() => {});
              }
              return;
            }
            if (messageTypes.progress && d?.type === messageTypes.progress) {
              progressReceived = true;
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('webview-progress', { detail: d }));
              }
              return;
            }
            if (messageTypes.receipts && d?.type === messageTypes.receipts) {
              if (tokensReceived) return;
              tokensReceived = true;
              console.log(`${LOG_PREFIX} Receipts message received (attempt ${extractionAttempts})`);
              runTokenVerdictThen(() => {
                beginTokenCleanupGrace();
                handleReceiptsMessage(d, (result) => {
                  instanceLatch.release();
                  endSession(sessionId);
                  finish.resolve?.(result);
                }, sessionId, loginMode, instanceLatch.getLatchedId()).catch((err) => {
                  console.error(`${LOG_PREFIX} receipts handler error`, err?.message || err);
                  const raw = extractRawReceipts(d) ?? [];
                  const filtered = filterReceipts ? filterReceipts(raw) : raw;
                  tokenStorage.store(extractTokensFromReceiptsMessage(d)).then(() => {
                    endSession(sessionId);
                    finish.resolve?.({
                      ...extractTokensFromReceiptsMessage(d),
                      receipts: parseReceipts(Array.isArray(filtered) ? filtered : []).filter(Boolean),
                      _fromWebView: true,
                    });
                  });
                });
              });
              return;
            }
            if (d?.type === messageTypes.tokens && extractTokensFromTokensMessage(d)) {
              if (tokensReceived) return;
              tokensReceived = true;
              console.log(`${LOG_PREFIX} Tokens message received (attempt ${extractionAttempts})`);
              runTokenVerdictThen(() => {
                beginTokenCleanupGrace();
                handleTokensMessage(d, (result) => {
                  instanceLatch.release();
                  endSession(sessionId);
                  finish.resolve?.(result);
                }, sessionId, loginMode, instanceLatch.getLatchedId()).catch((err) => {
                  console.error(`${LOG_PREFIX} tokens handler error`, err?.message || err);
                  tokenStorage.store(extractTokensFromTokensMessage(d)).then(() => {
                    endSession(sessionId);
                    finish.resolve?.({ ...extractTokensFromTokensMessage(d), _closeWebViewAfterFetch: true });
                  });
                });
              });
            }
          } catch (err) {
            console.error(`${LOG_PREFIX} messageFromWebview handler error`, err?.message || err);
          }
        });

        closeListener = await InAppBrowser.addListener('closeEvent', (event) => {
          if (!instanceLatch.acceptInstanceEvent('closeEvent', event)) return;
          if (tokensReceived) return;
          if (progressReceived) {
            bridgeDevLog(loginLogTag, `closeEvent: progress seen; grace 3s lastUrl=${(lastBrowserUrl || '').slice(0, 160)}`);
            // Fetch in progress — could be a foreign WebView closing; wait for receipts
            pendingGraceTimer = setTimeout(() => {
              if (tokensReceived) return;
              bridgeDevLog(loginLogTag, 'closeEvent: grace timeout → reject sync incomplete');
              void reportAnomaly(provider, SyncPhase.CLOSED_EARLY, censusMeta({
                mode: loginMode,
                reason: 'grace_timeout',
              }));
              cleanup();
              finish.reject?.(new Error('WebView closed before sync completed'));
            }, 3000);
            return;
          }
          // No progress seen — user closed early
          bridgeDevLog(loginLogTag, `closeEvent: user closed before tokens lastUrl=${(lastBrowserUrl || '').slice(0, 160)}`);
          console.warn(`${LOG_PREFIX} closeEvent - WebView closed before tokens extracted`);
          void reportAnomaly(provider, SyncPhase.CLOSED_EARLY, censusMeta({
            mode: loginMode,
            reason: 'user_closed_early',
          }));
          cleanup();
          finish.reject?.(new Error('WebView closed before tokens were extracted'));
        });

        urlListener = await InAppBrowser.addListener('urlChangeEvent', (ev) => {
          if (!instanceLatch.acceptInstanceEvent('urlChangeEvent', ev)) return;
          const u = ev?.url || '';
          lastBrowserUrl = u;
          logUrlScheme('urlChange', u);
          bridgeDevLog(
            loginLogTag,
            `urlChange: ${u.slice(0, 200)} isExtract=${isExtractUrl(u)} skipInjection=${shouldSkipInjectionForUrl(u)} tokensReceived=${tokensReceived}`
          );
          console.log(
            `${LOG_PREFIX} urlChange: ${u.slice(0, 180)}, tokensReceived=${tokensReceived}, isExtract=${isExtractUrl(u)}, skipInjection=${shouldSkipInjectionForUrl(u)}`
          );
          if (httpOnlyCookies) httpOnlyTokenInjected = false;
          if (tokensReceived) return;
          if (cookieProbe?.urlPatterns?.some((p) => u.includes(p))) {
            for (const probeUrl of cookieProbe.cookieUrls ?? []) {
              InAppBrowser.getCookies({ url: probeUrl, includeHttpOnly: true })
                .then((c) => {
                  const keys = Object.keys(c || {});
                  bridgeDevLog(
                    loginLogTag,
                    `cookieProbe ${probeUrl} count=${keys.length} names=${keys.join(',')}`
                  );
                })
                .catch(() => {});
            }
          }
          if (diagnosticProbe) {
            installDiagnosticProbeForUrl(u);
            const onWwwCostco =
              u.includes('www.costco.com') &&
              !shouldSkipInjectionForUrl(u);
            if (!checkpointA0Done && onWwwCostco) {
              checkpointA0Done = true;
              if (
                diagnosticProbe.isPurgeEnabled?.() &&
                !loopState.authComplete &&
                diagnosticProbe.getPurgeScript
              ) {
                runDiagnosticScript(diagnosticProbe.getPurgeScript());
              }
              emitDiagnosticCheckpoint('a0');
            }
          } else if (diagnosticInjectScript) {
            let diagHost = '';
            try {
              diagHost = new URL(u).hostname;
            } catch {
              try {
                diagHost = new URL(u, loginUrl).hostname;
              } catch {
                diagHost = u.slice(0, 80);
              }
            }
            if (diagHost && !diagnosticHostsInjected.has(diagHost)) {
              diagnosticHostsInjected.add(diagHost);
              InAppBrowser.executeScript(
                instanceLatch.scriptOpts(diagnosticInjectScript) || { code: diagnosticInjectScript }
              ).catch(() => {});
            }
          }
          if (loopDetection) {
            const wasAuthComplete = loopState.authComplete;
            const loopResult = evaluateLoginLoopDetection(u, loopDetection, loopState);
            if (!wasAuthComplete && loopState.authComplete) {
              void logPhase(provider, SyncPhase.AUTH_COMPLETE, { mode: loginMode });
              if (diagnosticProbe && !checkpointA1Done) {
                checkpointA1Done = true;
                emitDiagnosticCheckpoint('a1');
                if (a2Timer != null) clearTimeout(a2Timer);
                a2Timer = setTimeout(() => {
                  if (tokensReceived || checkpointA2Done) return;
                  checkpointA2Done = true;
                  emitDiagnosticCheckpoint('a2');
                }, 30000);
                if (a3Timer != null) clearTimeout(a3Timer);
                a3Timer = setTimeout(() => {
                  if (tokensReceived || checkpointA3Done) return;
                  checkpointA3Done = true;
                  emitDiagnosticCheckpoint('a3');
                }, 90000);
              }
            }
            if (loopResult.tripped) {
              bridgeDevLog(
                loginLogTag,
                `loop detected reason=${loopResult.reason ?? 'unknown'} hits=${loopResult.hits} lastUrl=${u.slice(0, 160)}`
              );
              void reportAnomaly(provider, SyncPhase.LOOP_DETECTED, {
                mode: loginMode,
                reason: loopResult.reason ?? 'unknown',
              });
              cleanupListeners();
              closeIfOwner(sessionId, LOG_PREFIX, provider, loginMode, instanceLatch.getLatchedId()).finally(() => {
                instanceLatch.release();
                endSession(sessionId);
              });
              finish.reject?.(
                new Error(loopResult.errorMessage || loopDetection.errorMessage)
              );
              return;
            }
          }
          if (isExtractUrl(u) && !shouldSkipInjectionForUrl(u)) {
            scheduleIdleWatchdog();
            runExtraction();
            setTimeout(runExtraction, 800);
            setTimeout(runExtraction, 2500);
          }
        });
        pageLoadedListener = await InAppBrowser.addListener('browserPageLoaded', (event) => {
          instanceLatch.acceptInstanceEvent('browserPageLoaded', event);
        });
      } catch (listenerErr) {
        console.error(`${LOG_PREFIX} Failed to register listeners`, listenerErr);
        throw listenerErr;
      }

      return new Promise((resolve, reject) => {
        finish.resolve = resolve;
        finish.reject = reject;
        extractInterval = setInterval(runExtraction, extractIntervalMs);
        scheduleLoginTimeout();

        instanceLatch.takePreOpenSnapshot();
        markWebViewOpening();
        bridgeDevLog(loginLogTag, `startLogin opening url=${loginUrl.slice(0, 200)}`);
        InAppBrowser.openWebView({
          url: loginUrl,
          title: loginTitle,
          toolbarType: ToolBarType.NAVIGATION,
          isPresentAfterPageLoad: false, // true causes blank screen on Android 13+ when URL redirects (safeway.com)
          isInspectable: true,
        })
          .then((result) => {
            instanceLatch.latchFromOpenResult(result);
            instanceLatch.scheduleLatchTimeout(() => runExtraction());
            bridgeDevLog(loginLogTag, 'startLogin WebView opened');
            void logPhase(provider, SyncPhase.WEBVIEW_OPENED, { mode: loginMode });
            console.log(`${LOG_PREFIX} WebView opened`);
            runExtraction();
          })
          .catch((err) => {
            bridgeDevLog(loginLogTag, `openWebView failed: ${(err?.message || err || '').toString().slice(0, 300)}`);
            void reportAnomaly(provider, SyncPhase.WEBVIEW_OPEN_FAILED, {
              mode: loginMode,
              reason: (err?.message || String(err)).slice(0, 200),
            });
            console.error(`${LOG_PREFIX} openWebView failed`, err);
            cleanup();
            reject(err);
          });
      });
    },

    async closeWebViewAfterFetch() {
      return closeWebView(LOG_PREFIX, provider, 'login', getActiveSyncId(provider), undefined);
    },

    async startSilentSync() {
      console.log(`${LOG_PREFIX} startSilentSync() called`);
      if (!Capacitor.isNativePlatform()) return null;

      const silentMode = 'silent';
      beginSyncAttempt(provider, silentMode);

      return new Promise((resolve) => {
        let received = false;
        let sessionId = null;
        let messageListener;
        let urlListener;
        let pageLoadedListener;
        let instanceLatch = null;
        let silentExtractInterval;
        let silentHttpOnlyInjected = false;
        let silentRefreshLatched = false;
        let silentDeadlineExtended = false;
        let silentStartedAt = Date.now();
        let silentDeadlineMs = silentTimeoutMs;
        let appRefreshAttempted = false;
        /** Last URL from urlChangeEvent (diagnostics / bridge logging only). */
        let silentLastUrl = '';
        const silentLogTag = `${provider}Silent`;
        let timeout;
        let lastCensusSummary = null;
        let lastCensusAtMs = 0;
        let sessionBackgroundMs = 0;
        let pausedAt = null;
        let silentOpenReady = false;
        let silentOpenFallbackTimer = null;

        const markSilentOpenReady = () => {
          if (silentOpenReady || received) return;
          silentOpenReady = true;
          if (silentOpenFallbackTimer != null) {
            clearTimeout(silentOpenFallbackTimer);
            silentOpenFallbackTimer = null;
          }
        };

        const silentCleanupListeners = () => {
          if (silentExtractInterval) clearInterval(silentExtractInterval);
          silentExtractInterval = null;
          if (silentOpenFallbackTimer != null) {
            clearTimeout(silentOpenFallbackTimer);
            silentOpenFallbackTimer = null;
          }
          messageListener?.remove?.();
          urlListener?.remove?.();
          pageLoadedListener?.remove?.();
          instanceLatch?.clearLatchTimer?.();
          unsubBackground?.();
          unsubForeground?.();
        };

        const censusMeta = (base) =>
          anomalyMetadataWithCensus(base, lastCensusSummary, lastCensusAtMs);

        const scheduleSilentTimeout = () => {
          if (timeout) clearTimeout(timeout);
          if (!isAppForeground()) {
            timeout = null;
            return;
          }
          const elapsed = Date.now() - silentStartedAt - sessionBackgroundMs;
          const remaining = Math.max(0, silentDeadlineMs - elapsed);
          timeout = setTimeout(onSilentTimeout, remaining);
        };

        const unsubBackground = onAppBackground(() => {
          if (received) return;
          pausedAt = Date.now();
          if (timeout) {
            clearTimeout(timeout);
            timeout = null;
          }
        });

        const unsubForeground = onAppForeground(() => {
          if (received) return;
          if (pausedAt != null) {
            sessionBackgroundMs += Date.now() - pausedAt;
            pausedAt = null;
          }
          scheduleSilentTimeout();
        });

        const extendSilentDeadline = () => {
          if (silentDeadlineExtended || received) return;
          silentDeadlineExtended = true;
          silentDeadlineMs = Math.min(silentDeadlineMs + 30_000, 90_000);
          bridgeDevLog(silentLogTag, `silent_deadline_extended ms=${silentDeadlineMs}`);
          scheduleSilentTimeout();
        };

        const stopSilentReInjection = () => {
          if (silentRefreshLatched) return;
          silentRefreshLatched = true;
          if (silentExtractInterval) {
            clearInterval(silentExtractInterval);
            silentExtractInterval = null;
          }
        };

        const finishNeedsReconnect = (reason) => {
          if (received) return;
          received = true;
          if (timeout) clearTimeout(timeout);
          silentCleanupListeners();
          void reportAnomaly(
            provider,
            SyncPhase.NEEDS_RECONNECT,
            censusMeta({
              mode: silentMode,
              reason: String(reason || 'needs_reconnect').slice(0, 200),
            })
          );
          closeIfOwner(sessionId, LOG_PREFIX, provider, silentMode, instanceLatch?.getLatchedId()).finally(() => {
            instanceLatch?.release();
            endSession(sessionId);
            resolve({ needs_reconnect: true, reason: reason || 'needs_reconnect' });
          });
        };

        const onSilentTimeout = () => {
          if (received) return;
          received = true;
          const orphanSuffix = instanceLatch?.hadForeignInstance() ? ' orphan_seen=1' : '';
          bridgeDevLog(
            silentLogTag,
            `silent timeout ${silentDeadlineMs / 1000}s lastUrl=${(silentLastUrl || '').slice(0, 160)}${orphanSuffix}`
          );
          console.log(`${LOG_PREFIX} startSilentSync: ${silentDeadlineMs / 1000}s timeout`);
          void reportAnomaly(
            provider,
            SyncPhase.SILENT_TIMEOUT,
            censusMeta({
              mode: silentMode,
              reason: instanceLatch?.hadForeignInstance() ? 'orphan_seen' : undefined,
            })
          );
          silentCleanupListeners();
          closeIfOwner(sessionId, LOG_PREFIX, provider, silentMode, instanceLatch?.getLatchedId()).finally(() => {
            instanceLatch?.release();
            endSession(sessionId);
          });
          resolve(null);
        };

        const sessionBegin = tryBeginSession({ mode: 'silent', provider, abort: () => silentAbort() });
        if (!sessionBegin.ok) {
          void logPhase(provider, SyncPhase.SESSION_BUSY, { mode: silentMode, reason: 'webview_busy' });
          void logPhase(provider, SyncPhase.SYNC_SKIPPED, { mode: silentMode, reason: 'webview_busy' });
          resolve({ _skipped: true, reason: 'webview_busy' });
          return;
        }
        sessionId = sessionBegin.id;
        instanceLatch = createInstanceLatch(sessionId, silentLogTag, provider, silentMode);
        const silentNonce = makeSyncNonce();

        const silentAbort = () => {
          if (received) return;
          received = true;
          if (timeout) clearTimeout(timeout);
          silentCleanupListeners();
          void instanceLatch.closeLatched();
          instanceLatch.release();
          void logPhase(provider, SyncPhase.SESSION_PREEMPTED, { mode: silentMode, reason: 'preempted' });
          void logPhase(provider, SyncPhase.SYNC_SKIPPED, { mode: silentMode, reason: 'preempted' });
          endSession(sessionId);
          resolve({ _skipped: true, reason: 'preempted' });
        };

        const runSilentHttpOnlyPoll = async () => {
          if (!httpOnlyCookies || received || silentHttpOnlyInjected) return;
          try {
            const cookies = await InAppBrowser.getCookies({
              url: httpOnlyCookies.url,
              includeHttpOnly: true,
            });
            const raw = cookies?.[httpOnlyCookies.cookieName];
            if (!raw) return;
            const parsed = httpOnlyCookies.parseToken(raw);
            if (!parsed) return;
            const tokenValue = parsed[httpOnlyCookies.injectKey];
            if (!tokenValue) return;
            const escaped = JSON.stringify(tokenValue);
            const code = `window.${httpOnlyCookies.injectVarName}=${escaped};`;
            const opts = instanceLatch.scriptOpts(code);
            if (!opts) return;
            await InAppBrowser.executeScript(opts);
            silentHttpOnlyInjected = true;
            console.log(`${LOG_PREFIX} [silent] Injected HttpOnly token (${httpOnlyCookies.injectVarName})`);
          } catch (err) {
            console.warn(`${LOG_PREFIX} [silent] getCookies failed:`, err?.message || err);
          }
        };

        const handleSilentDebugMessage = (d) => {
          if (d.message === 'msal-census') {
            const flat = flattenCensusFromDebugMessage(d);
            if (flat) {
              lastCensusSummary = flat;
              lastCensusAtMs = Date.now();
            }
            return false;
          }
          if (d.message === 'rt-refresh-start') {
            stopSilentReInjection();
            extendSilentDeadline();
            const flat = flattenCensusFromDebugMessage(d);
            if (flat) {
              lastCensusSummary = flat;
              lastCensusAtMs = Date.now();
            }
            return false;
          }
          if (d.message === 'rt-refresh-result') {
            const flat = flattenCensusFromDebugMessage(d);
            if (flat) {
              lastCensusSummary = flat;
              lastCensusAtMs = Date.now();
            }
            logRtRefreshExchange(provider, silentMode, d.data);
            return false;
          }
          return false;
        };

        const runAppRefreshIfNeeded = async () => {
          if (appRefreshAttempted || received || !silentAppRefresh) return;
          stopSilentReInjection();
          extendSilentDeadline();
          try {
            const refreshed = await silentAppRefresh();
            if (!refreshed?.idToken || received) return;
            appRefreshAttempted = true;
            const code = `window.__mealdInjectedIdToken=${JSON.stringify(refreshed.idToken)};`;
            const opts = instanceLatch.scriptOpts(code);
            if (opts) await InAppBrowser.executeScript(opts).catch(() => {});
            if (!silentRefreshLatched) {
              runSilentExtraction();
            }
          } catch (err) {
            const isTerminal =
              typeof isTerminalAppRefreshError === 'function' && isTerminalAppRefreshError(err);
            if (isTerminal) {
              appRefreshAttempted = true;
              const reason = String(err?.code || err?.message || 'app_refresh_failed').slice(0, 120);
              finishNeedsReconnect(reason);
              return;
            }
            bridgeDevLog(
              silentLogTag,
              `app_refresh_transient ${(err?.message || err || '').toString().slice(0, 120)}`
            );
            scheduleSilentTimeout();
          }
        };

        let silentExtractionAttempts = 0;
        const runSilentExtraction = () => {
          if (received || silentRefreshLatched || !silentOpenReady) return;
          if (!instanceLatch.canInject()) return;
          silentExtractionAttempts++;
          runSilentHttpOnlyPoll().then(async () => {
            let code = `window.__mealdSyncNonce=${JSON.stringify(silentNonce)};`;
            if (extractInstrumentationPrefix) code += extractInstrumentationPrefix();
            if (preExtractVars) code += preExtractVars();
            let smashArmed = false;
            if (silentPreExtractVars) {
              const silentPre = silentPreExtractVars();
              if (silentPre) {
                code += silentPre;
                smashArmed = true;
              }
            }
            code += EXTRACT_SCRIPT;
            const opts = instanceLatch.scriptOpts(code);
            if (!opts) return;
            InAppBrowser.executeScript(opts).catch((err) => {
              const em = err?.message || String(err);
              if (silentExtractionAttempts <= 3 || silentExtractionAttempts % 10 === 0) {
                bridgeDevLog(
                  silentLogTag,
                  `executeScript failed attempt=${silentExtractionAttempts} lastUrl=${(silentLastUrl || '').slice(0, 160)} s3=${smashArmed ? 1 : 0} err=${em.slice(0, 200)}`
                );
              }
            });
          });
        };

        scheduleSilentTimeout();

        const finish = (result) => {
          if (received) return;
          received = true;
          clearTimeout(timeout);
          silentCleanupListeners();
          closeBrowserForSessionBound(sessionId, silentMode, instanceLatch.getLatchedId()).finally(() => {
            instanceLatch.release();
            endSession(sessionId);
            resolve(result);
          });
        };

        (async () => {
          try {
            await prepareWebViewSessionStart(provider, silentMode);
            if (received) return;
            messageListener = await InAppBrowser.addListener('messageFromWebview', (event) => {
              if (!instanceLatch.acceptInstanceEvent('messageFromWebview', event)) return;
              try {
              const d = normalizeWebViewMessageDetail(event);
              if (!d) {
                if (isWebViewInstrumentationEnabled()) {
                  const keys =
                    event && typeof event === 'object' ? Object.keys(event).join(',') : '';
                  const detailType = typeof event?.detail;
                  bridgeDevLog(silentLogTag, `msg_dropped detail=${detailType} keys=${keys}`);
                }
                return;
              }
              if (d?.type === messageTypes.debug) {
                handleSilentDebugMessage(d);
                if (d.message === 'rt-refresh-start' || d.message === 'rt-refresh-result') {
                  try {
                    const safeData = d.data && typeof d.data === 'object' ? { ...d.data } : {};
                    delete safeData.refresh_token;
                    delete safeData.id_token;
                    const payload = `${d.message || ''} ${JSON.stringify(safeData)}`;
                    bridgeDevLog(silentLogTag, `webview debug: ${payload}`);
                  } catch {
                    bridgeDevLog(silentLogTag, `webview debug: ${d.message || ''}`);
                  }
                  return;
                }
                console.log(`${LOG_PREFIX} [silent] ${d.message || ''}`, d.data ?? '');
                try {
                  const payload = `${d.message || ''} ${JSON.stringify(d.data ?? {})}`;
                  bridgeDevLog(silentLogTag, `webview debug: ${payload}`);
                } catch {
                  bridgeDevLog(silentLogTag, `webview debug: ${d.message || ''}`);
                }
                return;
              }
              if (messageTypes.tokenRotated && d?.type === messageTypes.tokenRotated) {
                const tokens = extractTokensFromTokensMessage(d);
                tokenStorage.store(tokens).catch((err) => {
                  console.warn(`${LOG_PREFIX} token-rotated store failed`, err?.message || err);
                });
                return;
              }
              if (messageTypes.silentUnrecoverable && d?.type === messageTypes.silentUnrecoverable) {
                finishNeedsReconnect(d.reason || 'silent_unrecoverable');
                return;
              }
              if (messageTypes.appRefreshRequest && d?.type === messageTypes.appRefreshRequest) {
                void runAppRefreshIfNeeded();
                return;
              }
              if (messageTypes.progress && d?.type === messageTypes.progress) {
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('webview-progress', { detail: d }));
                }
                return;
              }
              if (messageTypes.receipts && d?.type === messageTypes.receipts) {
                if (received) return;
                void logPhase(provider, SyncPhase.RECEIPTS_RECEIVED, { mode: silentMode });
                const rawReceipts = extractRawReceipts(d) ?? [];
                const filtered = filterReceipts ? filterReceipts(rawReceipts) : rawReceipts;
                const receipts = parseReceipts(filtered).filter(Boolean);
                const tokens = extractTokensFromReceiptsMessage(d);
                closeBrowserForSessionBound(sessionId, silentMode, instanceLatch.getLatchedId()).then(() =>
                  tokenStorage.store(tokens)
                ).then(() => {
                  finish({ ...tokens, receipts, _fromWebView: true });
                }).catch((err) => {
                  console.error(`${LOG_PREFIX} startSilentSync receipts handler error`, err?.message || err);
                  tokenStorage.store(tokens).then(() => finish({ ...tokens, receipts, _fromWebView: true }));
                });
                return;
              }
              if (d?.type === messageTypes.tokens) {
                if (received) return;
                void logPhase(provider, SyncPhase.TOKENS_RECEIVED, { mode: silentMode });
                const tokens = extractTokensFromTokensMessage(d);
                (async () => {
                  let cookieHeader;
                  if (extractCookiesBeforeClose) {
                    cookieHeader = await extractCookiesBeforeClose().catch(() => undefined);
                  }
                  await closeBrowserForSessionBound(sessionId, silentMode, instanceLatch.getLatchedId());
                  await tokenStorage.store(tokens);
                  finish({
                    ...tokens,
                    _closeWebViewAfterFetch: true,
                    _tokensOnly: true,
                    cookieHeader,
                  });
                })().catch((err) => {
                  console.error(`${LOG_PREFIX} startSilentSync tokens handler error`, err?.message || err);
                  tokenStorage.store(tokens).then(() =>
                    finish({ ...tokens, _closeWebViewAfterFetch: true, _tokensOnly: true })
                  );
                });
              }
              } catch (err) {
                console.error(`${LOG_PREFIX} startSilentSync messageFromWebview handler error`, err?.message || err);
              }
            });

            urlListener = await InAppBrowser.addListener('urlChangeEvent', (ev) => {
              if (!instanceLatch.acceptInstanceEvent('urlChangeEvent', ev)) return;
              if (received) return;
              const u = ev?.url || '';
              silentLastUrl = u;
              bridgeDevLog(silentLogTag, `urlChange: ${u.slice(0, 200)} isExtract=${isExtractUrl(u)}`);
              silentHttpOnlyInjected = false;
              if (silentRefreshLatched) return;
              runSilentExtraction();
              setTimeout(runSilentExtraction, 800);
              setTimeout(runSilentExtraction, 2500);
            });

            pageLoadedListener = await InAppBrowser.addListener('browserPageLoaded', (event) => {
              if (!instanceLatch.acceptInstanceEvent('browserPageLoaded', event)) return;
              if (received) return;
              if (instanceLatch.getLatchedId()) markSilentOpenReady();
            });

            if (received) return;
            instanceLatch.takePreOpenSnapshot();
            markWebViewOpening();
            bridgeDevLog(silentLogTag, `startSilentSync opening url=${homeUrl.slice(0, 200)}`);
            silentOpenFallbackTimer = setTimeout(() => {
              markSilentOpenReady();
              runSilentExtraction();
            }, SILENT_OPEN_READY_FALLBACK_MS);
            const openResult = await InAppBrowser.openWebView({
              url: homeUrl,
              isPresentAfterPageLoad: true,
              width: 1,
              height: 1,
              x: -9999,
              y: -9999,
              isInspectable: true,
            });
            if (received) {
              const orphanId = openResult?.id;
              if (orphanId) {
                noteId(orphanId);
                await closeInstanceById(orphanId);
              } else if (getBelievedOpen()) {
                await InAppBrowser.close().catch(() => {});
              }
              return;
            }
            instanceLatch.latchFromOpenResult(openResult);
            markSilentOpenReady();
            instanceLatch.scheduleLatchTimeout(() => runSilentExtraction());
            silentLastUrl = homeUrl;
            silentStartedAt = Date.now();
            bridgeDevLog(silentLogTag, 'startSilentSync WebView opened');
            void logPhase(provider, SyncPhase.WEBVIEW_OPENED, { mode: silentMode });
            runSilentExtraction();
            silentExtractInterval = setInterval(runSilentExtraction, extractIntervalMs);
          } catch (err) {
            bridgeDevLog(silentLogTag, `startSilentSync failed: ${(err?.message || err || '').toString().slice(0, 300)}`);
            void reportAnomaly(provider, SyncPhase.WEBVIEW_OPEN_FAILED, {
              mode: silentMode,
              reason: (err?.message || String(err)).slice(0, 200),
            });
            console.error(`${LOG_PREFIX} startSilentSync failed`, err);
            if (timeout) clearTimeout(timeout);
            silentCleanupListeners();
            instanceLatch?.release();
            endSession(sessionId);
            resolve(null);
          }
        })();
      });
    },

    async storeTokens(values) {
      return tokenStorage.store(values);
    },

    async getStoredTokens() {
      return tokenStorage.get();
    },

    async hasStoredTokens() {
      return tokenStorage.has();
    },

    async clearStoredTokens() {
      await tokenStorage.clear();
      console.log(`${LOG_PREFIX} clearStoredTokens: cleared`);
    },
  };
}
