/**
 * Costco WebView Bridge - Orchestrates InAppBrowser for token extraction
 * Uses @capgo/inappbrowser for visible login and hidden silent sync modes.
 *
 * Token storage: Prefers @capacitor/preferences; falls back to localStorage
 * when Preferences plugin is not available (e.g. "not implemented on android").
 */

import { Capacitor } from '@capacitor/core';
import { InAppBrowser, ToolBarType } from '@capgo/inappbrowser';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
import { parseApiReceipt } from './costcoNativeSync';
import { log as debugLog } from './debugLogger';
import { getExtractScript } from './costcoExtractScript';

const LOG_PREFIX = '[CostcoWebViewBridge]';
const COSTCO_LOGIN_URL = 'https://www.costco.com/LogonForm';
const COSTCO_HOME_URL = 'https://www.costco.com';
const COSTCO_GRAPHQL_URL = 'https://ecom-api.costco.com/ebusiness/order/v1/orders/graphql';
/** Configurable timeout (ms) before rejecting if no tokens extracted. Default 5 minutes. */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
/** Domains where we run extraction (Costco + OAuth redirect URLs) */
const EXTRACT_DOMAINS = ['costco.com', 'signin.costco.com', 'login.microsoftonline.com', 'b2clogin.com'];
const PREF_KEYS = {
  ID_TOKEN: 'costco_spike_idToken',
  ACCESS_TOKEN: 'costco_spike_accessToken',
  CLIENT_ID: 'costco_spike_clientID',
  WCS_CLIENT_ID: 'costco_spike_wcsClientId',
  REFRESH_TOKEN: 'costco_spike_refreshToken',
  REFRESH_CLIENT_ID: 'costco_spike_refreshTokenClientId',
  USER_AGENT: 'costco_spike_userAgent',
};
const SECURE_KEYS = {
  REFRESH_TOKEN: 'costco_spike_refreshToken_secure',
  REFRESH_CLIENT_ID: 'costco_spike_refreshTokenClientId_secure',
};

const EXTRACT_SCRIPT = getExtractScript(COSTCO_GRAPHQL_URL);

let _preferencesAvailable = null;

async function isPreferencesAvailable() {
  if (_preferencesAvailable !== null) return _preferencesAvailable;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.get({ key: PREF_KEYS.ID_TOKEN });
    _preferencesAvailable = true;
  } catch {
    _preferencesAvailable = false;
  }
  return _preferencesAvailable;
}

function getLocalStorageKey(key) {
  return `costco_spike_${key}`;
}

/**
 * Store extracted tokens. Uses SecureStorage for refresh token (Keychain/Keystore);
 * other short-lived tokens use Preferences when available; falls back to localStorage.
 */
async function storeTokens({ idToken, accessToken, clientID, wcsClientId, refreshToken, refreshTokenClientId, userAgent }) {
  const usePrefs = await isPreferencesAvailable();
  if (usePrefs) {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key: PREF_KEYS.ID_TOKEN, value: idToken || '' });
    await Preferences.set({ key: PREF_KEYS.ACCESS_TOKEN, value: accessToken || '' });
    await Preferences.set({ key: PREF_KEYS.CLIENT_ID, value: clientID || '' });
    await Preferences.set({ key: PREF_KEYS.WCS_CLIENT_ID, value: wcsClientId || '' });
    await Preferences.set({ key: PREF_KEYS.USER_AGENT, value: userAgent || '' });
    if (refreshToken) {
      try {
        await SecureStoragePlugin.set({ key: SECURE_KEYS.REFRESH_TOKEN, value: refreshToken });
      } catch (_) {
        await Preferences.set({ key: PREF_KEYS.REFRESH_TOKEN, value: refreshToken });
      }
    } else {
      try {
        await SecureStoragePlugin.remove({ key: SECURE_KEYS.REFRESH_TOKEN });
      } catch (_) {}
      await Preferences.remove({ key: PREF_KEYS.REFRESH_TOKEN });
    }
    if (refreshTokenClientId) {
      try {
        await SecureStoragePlugin.set({ key: SECURE_KEYS.REFRESH_CLIENT_ID, value: refreshTokenClientId });
      } catch (_) {
        await Preferences.set({ key: PREF_KEYS.REFRESH_CLIENT_ID, value: refreshTokenClientId });
      }
    } else {
      try {
        await SecureStoragePlugin.remove({ key: SECURE_KEYS.REFRESH_CLIENT_ID });
      } catch (_) {}
      await Preferences.remove({ key: PREF_KEYS.REFRESH_CLIENT_ID });
    }
  } else if (typeof localStorage !== 'undefined') {
    localStorage.setItem(getLocalStorageKey('idToken'), idToken || '');
    localStorage.setItem(getLocalStorageKey('accessToken'), accessToken || '');
    localStorage.setItem(getLocalStorageKey('clientID'), clientID || '');
    localStorage.setItem(getLocalStorageKey('wcsClientId'), wcsClientId || '');
    localStorage.setItem(getLocalStorageKey('refreshToken'), refreshToken || '');
    localStorage.setItem(getLocalStorageKey('refreshTokenClientId'), refreshTokenClientId || '');
    localStorage.setItem(getLocalStorageKey('userAgent'), userAgent || '');
  }
}

/**
 * Retrieve stored tokens. Uses Preferences when available; falls back to localStorage.
 */
export async function getStoredTokens() {
  const usePrefs = await isPreferencesAvailable();
  // #region agent log
  debugLog('costcoWebViewBridge.js:getStoredTokens', 'getStoredTokens', { usePreferences: usePrefs }, 'H5');
  // #endregion
  if (usePrefs) {
    const { Preferences } = await import('@capacitor/preferences');
    const { value: idToken } = await Preferences.get({ key: PREF_KEYS.ID_TOKEN });
    const { value: accessToken } = await Preferences.get({ key: PREF_KEYS.ACCESS_TOKEN });
    const { value: clientID } = await Preferences.get({ key: PREF_KEYS.CLIENT_ID });
    const { value: wcsClientId } = await Preferences.get({ key: PREF_KEYS.WCS_CLIENT_ID });
    const { value: userAgent } = await Preferences.get({ key: PREF_KEYS.USER_AGENT });
    let refreshToken = null;
    let refreshTokenClientId = null;
    try {
      const rt = await SecureStoragePlugin.get({ key: SECURE_KEYS.REFRESH_TOKEN });
      refreshToken = rt?.value ?? null;
    } catch (_) {
      const { value: rt } = await Preferences.get({ key: PREF_KEYS.REFRESH_TOKEN });
      refreshToken = rt ?? null;
    }
    try {
      const rtc = await SecureStoragePlugin.get({ key: SECURE_KEYS.REFRESH_CLIENT_ID });
      refreshTokenClientId = rtc?.value ?? null;
    } catch (_) {
      const { value: rtc } = await Preferences.get({ key: PREF_KEYS.REFRESH_CLIENT_ID });
      refreshTokenClientId = rtc ?? null;
    }
    // #region agent log
    debugLog('costcoWebViewBridge.js:getStoredTokens', 'Tokens from Preferences', { hasIdToken: Boolean(idToken), hasAccessToken: Boolean(accessToken), hasRefreshToken: Boolean(refreshToken) }, 'H5');
    // #endregion
    return { idToken, accessToken, clientID, wcsClientId, refreshToken, refreshTokenClientId, userAgent };
  }
  if (typeof localStorage !== 'undefined') {
    const result = {
      idToken: localStorage.getItem(getLocalStorageKey('idToken')),
      accessToken: localStorage.getItem(getLocalStorageKey('accessToken')),
      clientID: localStorage.getItem(getLocalStorageKey('clientID')),
      wcsClientId: localStorage.getItem(getLocalStorageKey('wcsClientId')),
      refreshToken: localStorage.getItem(getLocalStorageKey('refreshToken')),
      refreshTokenClientId: localStorage.getItem(getLocalStorageKey('refreshTokenClientId')),
      userAgent: localStorage.getItem(getLocalStorageKey('userAgent')),
    };
    // #region agent log
    debugLog('costcoWebViewBridge.js:getStoredTokens', 'Tokens from localStorage', { hasIdToken: Boolean(result.idToken), hasAccessToken: Boolean(result.accessToken), hasRefreshToken: Boolean(result.refreshToken) }, 'H5');
    // #endregion
    return result;
  }
  return { idToken: null, accessToken: null, clientID: null, wcsClientId: null, refreshToken: null, refreshTokenClientId: null, userAgent: null };
}

/**
 * Check if we have any stored tokens
 */
export async function hasStoredTokens() {
  const { idToken, accessToken } = await getStoredTokens();
  return Boolean(idToken || accessToken);
}

/**
 * Clear stored tokens. Call when tokens are invalid/expired so next sync forces fresh login.
 */
export async function clearStoredTokens() {
  // #region agent log
  debugLog('costcoWebViewBridge.js:clearStoredTokens', 'clearStoredTokens called', { stack: new Error().stack?.split('\n').slice(1, 4).join(' | ') }, 'H2');
  // #endregion
  const usePrefs = await isPreferencesAvailable();
  if (usePrefs) {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.remove({ key: PREF_KEYS.ID_TOKEN });
    await Preferences.remove({ key: PREF_KEYS.ACCESS_TOKEN });
    await Preferences.remove({ key: PREF_KEYS.CLIENT_ID });
    await Preferences.remove({ key: PREF_KEYS.REFRESH_TOKEN });
    await Preferences.remove({ key: PREF_KEYS.REFRESH_CLIENT_ID });
    await Preferences.remove({ key: PREF_KEYS.USER_AGENT });
    try {
      await SecureStoragePlugin.remove({ key: SECURE_KEYS.REFRESH_TOKEN });
    } catch (_) {}
    try {
      await SecureStoragePlugin.remove({ key: SECURE_KEYS.REFRESH_CLIENT_ID });
    } catch (_) {}
  } else if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(getLocalStorageKey('idToken'));
    localStorage.removeItem(getLocalStorageKey('accessToken'));
    localStorage.removeItem(getLocalStorageKey('clientID'));
    localStorage.removeItem(getLocalStorageKey('wcsClientId'));
    localStorage.removeItem(getLocalStorageKey('refreshToken'));
    localStorage.removeItem(getLocalStorageKey('refreshTokenClientId'));
    localStorage.removeItem(getLocalStorageKey('userAgent'));
  }
  // #region agent log
  debugLog('costcoWebViewBridge.js:clearStoredTokens', 'Tokens cleared', { usedPreferences: usePrefs }, 'H2');
  // #endregion
  console.log(`${LOG_PREFIX} clearStoredTokens: cleared invalid/expired tokens`);
}

/**
 * Open visible WebView for manual Costco login.
 * Waits for messageFromWebview with costco-tokens, then closes and returns tokens.
 * @returns {Promise<{idToken:string,clientID:string,refreshToken:string|null,refreshTokenClientId:string|null,userAgent:string}>}
 */
export async function startLogin() {
  // #region agent log
  debugLog('costcoWebViewBridge.js:startLogin', 'startLogin called', { platform: Capacitor.getPlatform(), isNative: Capacitor.isNativePlatform() }, 'H4');
  // #endregion
  console.log(`${LOG_PREFIX} startLogin() called, platform=${Capacitor.getPlatform()}`);
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Costco WebView bridge requires a native platform (iOS/Android)');
  }

  let messageListener;
  let closeListener;
  let urlListener;
  let tokensReceived = false;
  let extractInterval;
  let timeoutHandle;
  const finish = { resolve: null, reject: null };

  const isExtractUrl = (url) => {
    if (!url) return false;
    return EXTRACT_DOMAINS.some((d) => url.includes(d));
  };

  const runExtraction = () => {
    if (tokensReceived) return;
    InAppBrowser.executeScript({ code: EXTRACT_SCRIPT }).catch(() => {});
  };

  const cleanup = () => {
    messageListener?.remove?.();
    closeListener?.remove?.();
    urlListener?.remove?.();
    if (extractInterval != null) {
      clearInterval(extractInterval);
      extractInterval = null;
    }
    if (timeoutHandle != null) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  };

  // Register listeners FIRST and await so they are ready before WebView can send messages
  try {
    messageListener = await InAppBrowser.addListener('messageFromWebview', (event) => {
      try {
        const d = event?.detail;
        // #region agent log
        debugLog('costcoWebViewBridge.js:messageFromWebview', 'messageFromWebview received', { type: d?.type, hasIdToken: Boolean(d?.idToken) }, 'H4');
        // #endregion
        console.log(`${LOG_PREFIX} messageFromWebview received`, JSON.stringify({ type: d?.type, hasIdToken: Boolean(d?.idToken) }));
        if (d?.type === 'costco-webview-fetch-debug') {
          debugLog('costcoWebViewBridge.js:webviewFetchDebug', d?.message || 'webview fetch', d?.data || {}, 'H4');
        }
      if (d?.type === 'graphql-curl' && d?.curl) {
        console.log(`${LOG_PREFIX} GraphQL cURL (successful request from WebView):`);
        console.log(d.curl);
        debugLog('costcoWebViewBridge.js:graphql-curl', 'GraphQL cURL captured', { curl: d.curl }, 'graphql-curl');
      }
      if (d?.type === 'costco-receipts' && Array.isArray(d?.receipts)) {
        if (tokensReceived) return;
        tokensReceived = true;
        const rawReceipts = d.receipts || [];
        const groceryRaw = rawReceipts.filter(
          (r) => (r.receiptType || 'warehouse').toLowerCase() === 'warehouse'
        );
        const receipts = groceryRaw.map((r) => parseApiReceipt(r)).filter(Boolean);
        debugLog('costcoWebViewBridge.js:receiptsFromWebView', 'Receipts from in-WebView fetch', {
          rawCount: rawReceipts.length,
          parsedCount: receipts.length,
        }, 'H4');
        console.log(`${LOG_PREFIX} Receipts fetched directly from WebView: ${receipts.length} receipts`);
        cleanup();
        closeWebViewAfterFetch().then(() =>
          storeTokens({
            idToken: d.idToken || d.accessToken,
            accessToken: d.accessToken || null,
            clientID: d.clientID,
            wcsClientId: d.wcsClientId,
            refreshToken: d.refreshToken,
            refreshTokenClientId: d.refreshTokenClientId,
            userAgent: d.userAgent,
          })
        ).then(() => {
          finish.resolve?.({
            idToken: d.idToken,
            accessToken: d.accessToken || null,
            clientID: d.clientID,
            wcsClientId: d.wcsClientId,
            refreshToken: d.refreshToken || null,
            refreshTokenClientId: d.refreshTokenClientId || null,
            userAgent: d.userAgent || '',
            receipts,
            _fromWebView: true,
          });
        }).catch((err) => {
          console.error(`${LOG_PREFIX} costco-receipts handler error`, err?.message || err);
          storeTokens({
            idToken: d.idToken || d.accessToken,
            accessToken: d.accessToken || null,
            clientID: d.clientID,
            wcsClientId: d.wcsClientId,
            refreshToken: d.refreshToken,
            refreshTokenClientId: d.refreshTokenClientId,
            userAgent: d.userAgent,
          }).then(() => {
            finish.resolve?.({
              idToken: d.idToken,
              accessToken: d.accessToken || null,
              clientID: d.clientID,
              wcsClientId: d.wcsClientId,
              refreshToken: d.refreshToken || null,
              refreshTokenClientId: d.refreshTokenClientId || null,
              userAgent: d.userAgent || '',
              receipts,
              _fromWebView: true,
            });
          });
        });
        return;
      }
      if (d?.type === 'costco-tokens' && (d?.idToken || d?.accessToken)) {
        if (tokensReceived) return; // Already handling; extraction script fires repeatedly
        tokensReceived = true;
        const idLen = (d?.idToken || '').length;
        const accLen = (d?.accessToken || '').length;
        const cidLen = (d?.clientID || '').length;
        // #region agent log
        debugLog('costcoWebViewBridge.js:tokensExtracted', 'Tokens extracted', {
          idTokenLen: idLen,
          accessTokenLen: accLen,
          clientIDLen: cidLen,
          capturedFromGraphQL: Boolean(d?.capturedFromGraphQL),
          tokenTooShort: idLen < 400 && accLen < 400,
        }, 'H4');
        // #endregion
        console.log(`${LOG_PREFIX} Tokens extracted (tokens only, closing WebView; caller will use backend fallback)`);
        cleanup();
        closeWebViewAfterFetch().then(() =>
          storeTokens({
            idToken: d.idToken || d.accessToken,
            accessToken: d.accessToken || null,
            clientID: d.clientID,
            wcsClientId: d.wcsClientId,
            refreshToken: d.refreshToken,
            refreshTokenClientId: d.refreshTokenClientId,
            userAgent: d.userAgent,
          })
        ).then(() => {
          finish.resolve?.({
            idToken: d.idToken,
            accessToken: d.accessToken || null,
            clientID: d.clientID,
            wcsClientId: d.wcsClientId,
            refreshToken: d.refreshToken || null,
            refreshTokenClientId: d.refreshTokenClientId || null,
            userAgent: d.userAgent || '',
            _closeWebViewAfterFetch: true,
          });
        }).catch((err) => {
          console.error(`${LOG_PREFIX} costco-tokens handler error`, err?.message || err);
          storeTokens({
            idToken: d.idToken || d.accessToken,
            accessToken: d.accessToken || null,
            clientID: d.clientID,
            wcsClientId: d.wcsClientId,
            refreshToken: d.refreshToken,
            refreshTokenClientId: d.refreshTokenClientId,
            userAgent: d.userAgent,
          }).then(() => {
            finish.resolve?.({
              idToken: d.idToken,
              accessToken: d.accessToken || null,
              clientID: d.clientID,
              wcsClientId: d.wcsClientId,
              refreshToken: d.refreshToken || null,
              refreshTokenClientId: d.refreshTokenClientId || null,
              userAgent: d.userAgent || '',
              _closeWebViewAfterFetch: true,
            });
          });
        });
      }
      } catch (err) {
        console.error(`${LOG_PREFIX} messageFromWebview handler error`, err?.message || err);
      }
    });

      closeListener = await InAppBrowser.addListener('closeEvent', () => {
        if (tokensReceived) return; // Tokens already received; ignore close (race with InAppBrowser.close)
        // #region agent log
        debugLog('costcoWebViewBridge.js:closeEvent', 'closeEvent fired - WebView closed before tokens extracted', {}, 'H4');
        // #endregion
        console.warn(`${LOG_PREFIX} closeEvent fired - WebView closed before tokens were extracted`);
        cleanup();
        finish.reject?.(new Error('WebView closed before tokens were extracted'));
        // Note: User closed manually; InAppBrowser.close() not needed
      });

      urlListener = await InAppBrowser.addListener('urlChangeEvent', (ev) => {
        const u = ev?.url || '';
        console.log(`${LOG_PREFIX} urlChangeEvent`, u);
        if (tokensReceived) return;
        if (isExtractUrl(u) && !u.includes('/LogonForm')) {
          console.log(`${LOG_PREFIX} On Costco/OAuth URL, running extraction (now + 800ms)`);
          runExtraction();
          setTimeout(runExtraction, 800);
        }
      });
  } catch (listenerErr) {
    console.error(`${LOG_PREFIX} Failed to register listeners`, listenerErr);
    throw listenerErr;
  }

  return new Promise((resolve, reject) => {
    finish.resolve = resolve;
    finish.reject = reject;
    extractInterval = setInterval(runExtraction, 3000);

    timeoutHandle = setTimeout(() => {
      if (tokensReceived) return;
      console.warn(`${LOG_PREFIX} Login timeout (${LOGIN_TIMEOUT_MS / 1000}s) - no tokens extracted`);
      cleanup();
      InAppBrowser.close().catch(() => {});
      finish.reject?.(new Error('Costco login timed out. Please try again and complete sign-in within 5 minutes.'));
    }, LOGIN_TIMEOUT_MS);

    InAppBrowser.openWebView({
      url: COSTCO_LOGIN_URL,
      title: 'Sign in to Costco',
      toolbarType: ToolBarType.NAVIGATION,
      preShowScript: EXTRACT_SCRIPT,
      preShowScriptInjectionTime: 'pageLoad',
      isPresentAfterPageLoad: true,
    }).then(() => {
      // #region agent log
      debugLog('costcoWebViewBridge.js:openWebView', 'WebView opened successfully', {}, 'H4');
      // #endregion
      console.log(`${LOG_PREFIX} WebView opened, extractInterval running every 800ms`);
    }).catch((err) => {
      // #region agent log
      debugLog('costcoWebViewBridge.js:openWebViewFailed', 'openWebView failed', { errMsg: err?.message || String(err) }, 'H4');
      // #endregion
      console.error(`${LOG_PREFIX} openWebView failed`, err);
      cleanup();
      reject(err);
    });
  });
}

/**
 * Close the WebView. Call after fetch completes to dismiss the Costco login screen.
 * Retries up to 3 times with 300ms delay between attempts.
 */
export async function closeWebViewAfterFetch() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await InAppBrowser.close();
      console.log(`${LOG_PREFIX} WebView closed (attempt ${attempt})`);
      return;
    } catch (err) {
      console.warn(`${LOG_PREFIX} close attempt ${attempt} failed:`, err?.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 300));
    }
  }
}

/**
 * Open hidden WebView to extract still-valid tokens and optionally receipts from persistent session.
 * Uses 1x1 off-screen WebView. Prefers costco-receipts (tokens + receipts); falls back to costco-tokens (tokens only).
 * @returns {Promise<{idToken:string,clientID:string,refreshToken:string|null,receipts?:Array,_fromWebView?:boolean}|null>}
 */
export async function startSilentSync() {
  // #region agent log
  debugLog('costcoWebViewBridge.js:startSilentSync', 'startSilentSync called', {}, 'H3');
  // #endregion
  console.log(`${LOG_PREFIX} startSilentSync() called`);
  if (!Capacitor.isNativePlatform()) {
    return null;
  }

  return new Promise((resolve) => {
    let received = false;

    const timeout = setTimeout(() => {
      if (received) return;
      console.log(`${LOG_PREFIX} startSilentSync: 15s timeout, no tokens extracted`);
      messageListener?.remove?.();
      InAppBrowser.close().catch(() => {});
      resolve(null);
    }, 15000); // 15s max for silent extraction

    let messageListener;

    const finish = (result) => {
      if (received) return;
      received = true;
      clearTimeout(timeout);
      messageListener?.remove?.();
      InAppBrowser.close().catch(() => {});
      resolve(result);
    };

    (async () => {
      try {
        messageListener = await InAppBrowser.addListener('messageFromWebview', (event) => {
      const d = event?.detail;
      if (d?.type === 'costco-receipts' && Array.isArray(d?.receipts)) {
        if (received) return;
        const rawReceipts = d.receipts || [];
        const groceryRaw = rawReceipts.filter(
          (r) => (r.receiptType || 'warehouse').toLowerCase() === 'warehouse'
        );
        const receipts = groceryRaw.map((r) => parseApiReceipt(r)).filter(Boolean);
        console.log(`${LOG_PREFIX} startSilentSync: receipts fetched from hidden WebView (${receipts.length})`);
        closeWebViewAfterFetch().then(() =>
          storeTokens({
            idToken: d.idToken || d.accessToken,
            accessToken: d.accessToken || null,
            clientID: d.clientID,
            wcsClientId: d.wcsClientId,
            refreshToken: d.refreshToken,
            refreshTokenClientId: d.refreshTokenClientId,
            userAgent: d.userAgent,
          })
        ).then(() => {
          finish({
            idToken: d.idToken,
            accessToken: d.accessToken || null,
            clientID: d.clientID,
            wcsClientId: d.wcsClientId,
            refreshToken: d.refreshToken || null,
            refreshTokenClientId: d.refreshTokenClientId || null,
            userAgent: d.userAgent || '',
            receipts,
            _fromWebView: true,
          });
        }).catch((err) => {
          console.error(`${LOG_PREFIX} startSilentSync costco-receipts handler error`, err?.message || err);
          storeTokens({
            idToken: d.idToken || d.accessToken,
            accessToken: d.accessToken || null,
            clientID: d.clientID,
            wcsClientId: d.wcsClientId,
            refreshToken: d.refreshToken,
            refreshTokenClientId: d.refreshTokenClientId,
            userAgent: d.userAgent,
          }).then(() => {
            finish({
              idToken: d.idToken,
              accessToken: d.accessToken || null,
              clientID: d.clientID,
              wcsClientId: d.wcsClientId,
              refreshToken: d.refreshToken || null,
              refreshTokenClientId: d.refreshTokenClientId || null,
              userAgent: d.userAgent || '',
              receipts,
              _fromWebView: true,
            });
          });
        });
        return;
      }
      if (d?.type === 'costco-tokens' && (d?.idToken || d?.accessToken)) {
        if (received) return;
        console.log(`${LOG_PREFIX} startSilentSync: tokens extracted from hidden WebView (no receipts)`);
        closeWebViewAfterFetch().then(() =>
          storeTokens({
            idToken: d.idToken || d.accessToken,
            accessToken: d.accessToken || null,
            clientID: d.clientID,
            wcsClientId: d.wcsClientId,
            refreshToken: d.refreshToken,
            refreshTokenClientId: d.refreshTokenClientId,
            userAgent: d.userAgent,
          })
        ).then(() => {
          finish({
            idToken: d.idToken,
            accessToken: d.accessToken || null,
            clientID: d.clientID,
            wcsClientId: d.wcsClientId,
            refreshToken: d.refreshToken || null,
            refreshTokenClientId: d.refreshTokenClientId || null,
            userAgent: d.userAgent || '',
            _closeWebViewAfterFetch: true,
          });
        }).catch((err) => {
          console.error(`${LOG_PREFIX} startSilentSync costco-tokens handler error`, err?.message || err);
          storeTokens({
            idToken: d.idToken || d.accessToken,
            accessToken: d.accessToken || null,
            clientID: d.clientID,
            wcsClientId: d.wcsClientId,
            refreshToken: d.refreshToken,
            refreshTokenClientId: d.refreshTokenClientId,
            userAgent: d.userAgent,
          }).then(() => {
            finish({
              idToken: d.idToken,
              accessToken: d.accessToken || null,
              clientID: d.clientID,
              wcsClientId: d.wcsClientId,
              refreshToken: d.refreshToken || null,
              refreshTokenClientId: d.refreshTokenClientId || null,
              userAgent: d.userAgent || '',
              _closeWebViewAfterFetch: true,
            });
          });
        });
      }
    });

        InAppBrowser.openWebView({
      url: COSTCO_HOME_URL,
      preShowScript: EXTRACT_SCRIPT,
      preShowScriptInjectionTime: 'pageLoad',
      isPresentAfterPageLoad: true,
      width: 1,
      height: 1,
      x: -9999,
      y: -9999,
    }).catch((err) => {
      console.error(`${LOG_PREFIX} startSilentSync: openWebView failed`, err);
      clearTimeout(timeout);
      messageListener?.remove?.();
      resolve(null);
    });
      } catch (err) {
        console.error(`${LOG_PREFIX} startSilentSync: addListener failed`, err);
        clearTimeout(timeout);
        resolve(null);
      }
    })();
  });
}
