/**
 * Safeway WebView Bridge - InAppBrowser for token + clubCard extraction plus cookies for native HTTP.
 * Receipt list/detail API calls run in the app via safewayApiFetcher (CapacitorHttp).
 */

import { InAppBrowser } from '@capgo/inappbrowser';
import { createWebViewBridge } from './webViewBridge';
import { createTokenStorage } from './tokenStorage';
import { getExtractScript } from './safewayExtractScript';
import { buildCookieHeader } from './safewayCookieHeader';
import { postDevLog } from './apiClient';
import { classifySafewaySilentResult } from './safewaySilentSyncOutcome';
import {
  isSafewayDevDiagnosticsEnabled,
  isSafewaySReconnectSmashArmed,
  consumeSafewaySReconnectSmashFlag,
  restoreSafewaySReconnectSmashFlag,
  clearSafewaySReconnectSmashFlag,
} from './safewayDiagnosticSettings';
import { getSafewaySReconnectSmashScript } from './safewaySReconnectSmashScript';

const SAFEWAY_COOKIE_URL = 'https://www.safeway.com';
const SWY_SHARED_SESSION = 'SWY_SHARED_SESSION';

/** Cookie header for safewayApiFetcher before InAppBrowser closes (session cookies not in main WebView). */
async function extractSafewayCookies() {
  const cookies = await InAppBrowser.getCookies({
    url: SAFEWAY_COOKIE_URL,
    includeHttpOnly: true,
  });
  return buildCookieHeader(cookies, { tier: 'full' });
}

function parseSharedSessionAccessToken(raw) {
  if (!raw) return null;
  try {
    const decoded = typeof raw === 'string' ? decodeURIComponent(raw) : raw;
    const j = JSON.parse(decoded);
    return j.accessToken ? { accessToken: j.accessToken } : null;
  } catch {
    return null;
  }
}

/** True after S-reconnect smash flag consumed for the current silent session inject loop. */
let sReconnectSmashConsumedThisSession = false;

function buildSilentPreExtractVars() {
  if (!isSafewayDevDiagnosticsEnabled()) return null;
  if (sReconnectSmashConsumedThisSession) return getSafewaySReconnectSmashScript();
  if (!isSafewaySReconnectSmashArmed()) return null;
  consumeSafewaySReconnectSmashFlag();
  sReconnectSmashConsumedThisSession = true;
  postDevLog('safewaySilent', 's_reconnect_smash consumed=1');
  return getSafewaySReconnectSmashScript();
}

function skipSilentHttpOnlyInject() {
  return sReconnectSmashConsumedThisSession;
}

/**
 * After a silent timeout, probe HttpOnly session cookie once to distinguish dead session vs leftover hang.
 * @param {null} result
 * @returns {Promise<object|null>}
 */
async function upgradeSilentTimeoutWithCookieProbe(result) {
  if (result !== null) return result;
  try {
    const cookies = await InAppBrowser.getCookies({
      url: SAFEWAY_COOKIE_URL,
      includeHttpOnly: true,
    });
    const raw = cookies?.[SWY_SHARED_SESSION];
    const parsed = parseSharedSessionAccessToken(raw);
    if (parsed?.accessToken) {
      postDevLog('safewaySilent', 'cookie_probe cookie=present');
      return null;
    }
    postDevLog('safewaySilent', 'cookie_probe cookie=absent');
    return { needs_reconnect: true, reason: 'missing_session_cookie' };
  } catch (err) {
    postDevLog(
      'safewaySilent',
      `cookie_probe cookie=unread err=${String(err?.message || err).slice(0, 120)}`
    );
    return null;
  }
}

const tokenStorage = createTokenStorage({
  prefKeys: {
    accessToken: 'safeway_accessToken',
    clubCard: 'safeway_clubCard',
  },
  secureKeys: {},
  localStoragePrefix: 'safeway_',
  hasCheckKeys: ['accessToken'],
});

const bridge = createWebViewBridge({
  provider: 'safeway',
  loginUrl: 'https://www.safeway.com/',
  homeUrl: 'https://www.safeway.com',
  extractDomains: ['safeway.com', 'signin.safeway.com'],
  getExtractScript,
  httpOnlyCookies: {
    url: SAFEWAY_COOKIE_URL,
    cookieName: SWY_SHARED_SESSION,
    parseToken: parseSharedSessionAccessToken,
    injectKey: 'accessToken',
    injectVarName: '__injectedAccessToken',
    skipSilentInject: skipSilentHttpOnlyInject,
  },
  messageTypes: {
    tokens: 'safeway-tokens',
    debug: 'safeway-webview-fetch-debug',
    progress: 'safeway-progress',
    silentUnrecoverable: 'safeway-silent-unrecoverable',
  },
  tokenStorage,
  extractTokensFromTokensMessage: (d) => ({
    accessToken: d.accessToken,
    clubCard: d.clubCard,
  }),
  loginTimeoutMs: 5 * 60 * 1000,
  silentTimeoutMs: 15_000,
  loginTitle: 'Sign in to Safeway',
  extractCookiesBeforeClose: extractSafewayCookies,
  silentPreExtractVars: buildSilentPreExtractVars,
});

export const SAFEWAY_RECONNECT_COOLDOWN_KEY = 'sync_reconnectCooldown_safeway';
const RECONNECT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export async function startLogin() {
  clearSafewaySReconnectSmashFlag();
  sReconnectSmashConsumedThisSession = false;
  return bridge.startLogin();
}

export async function startSilentSync() {
  sReconnectSmashConsumedThisSession = false;
  try {
    let result = await bridge.startSilentSync();
    const kindBeforeProbe = classifySafewaySilentResult(result);
    if (kindBeforeProbe === 'timeout') {
      result = await upgradeSilentTimeoutWithCookieProbe(result);
    }
    const kind = classifySafewaySilentResult(result);
    if (sReconnectSmashConsumedThisSession) {
      postDevLog('safewaySilent', `s_reconnect_smash_result kind=${kind ?? 'null'}`);
      if (kind !== 'needs_reconnect') {
        restoreSafewaySReconnectSmashFlag();
      }
    }
    return result;
  } catch (err) {
    if (sReconnectSmashConsumedThisSession) {
      restoreSafewaySReconnectSmashFlag();
    }
    throw err;
  } finally {
    sReconnectSmashConsumedThisSession = false;
  }
}

export const closeWebViewAfterFetch = bridge.closeWebViewAfterFetch.bind(bridge);
export const getStoredTokens = bridge.getStoredTokens.bind(bridge);
export const hasStoredTokens = bridge.hasStoredTokens.bind(bridge);
export const clearStoredTokens = bridge.clearStoredTokens.bind(bridge);

/** Mark Safeway silent sync suppressed until cooldown expires or interactive connect succeeds. */
export async function setSafewayReconnectCooldown() {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({
      key: SAFEWAY_RECONNECT_COOLDOWN_KEY,
      value: String(Date.now() + RECONNECT_COOLDOWN_MS),
    });
  } catch {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(
        SAFEWAY_RECONNECT_COOLDOWN_KEY,
        String(Date.now() + RECONNECT_COOLDOWN_MS)
      );
    }
  }
}

/** Clear reconnect cooldown after a successful interactive connect or silent sync. */
export async function clearSafewayReconnectCooldown() {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.remove({ key: SAFEWAY_RECONNECT_COOLDOWN_KEY });
  } catch {
    /* ignore */
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(SAFEWAY_RECONNECT_COOLDOWN_KEY);
  }
}

/** @returns {Promise<boolean>} true if silent sync should be skipped due to reconnect cooldown */
export async function isSafewayReconnectCooldownActive() {
  let raw = null;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: SAFEWAY_RECONNECT_COOLDOWN_KEY });
    raw = value;
  } catch {
    if (typeof localStorage !== 'undefined') {
      raw = localStorage.getItem(SAFEWAY_RECONNECT_COOLDOWN_KEY);
    }
  }
  if (!raw) return false;
  const until = Number(raw);
  if (!until || Number.isNaN(until)) return false;
  return Date.now() < until;
}

export { fetchSafewayReceipts } from './safewayApiFetcher';
export { buildCookieHeader, isAllowedSafewayCookieKey } from './safewayCookieHeader';
