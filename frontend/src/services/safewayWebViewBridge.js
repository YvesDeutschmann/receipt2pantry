/**
 * Safeway WebView Bridge - InAppBrowser for token + clubCard extraction plus cookies for native HTTP.
 * Receipt list/detail API calls run in the app via safewayApiFetcher (CapacitorHttp).
 */

import { InAppBrowser } from '@capgo/inappbrowser';
import { createWebViewBridge } from './webViewBridge';
import { createTokenStorage } from './tokenStorage';
import { getExtractScript } from './safewayExtractScript';

/** Only auth + edge/WAF cookies; analytics (reese84, AMCV*, _ga, Optanon*, etc.) bloat the header → HTTP 431. */
function isAllowedSafewayCookieKey(k) {
  if (!k || typeof k !== 'string') return false;
  return (
    k.startsWith('SWY_') ||
    k.startsWith('ACI_S_') ||
    k === 'JSESSIONID' ||
    k === 'abs_gsession' ||
    k.startsWith('akacd_PR-') ||
    k.startsWith('visid_incap_') ||
    k.startsWith('nlbi_') ||
    k.startsWith('incap_ses_')
  );
}

/** Cookie header for safewayApiFetcher before InAppBrowser closes (session cookies not in main WebView). */
async function extractSafewayCookies() {
  const cookies = await InAppBrowser.getCookies({
    url: 'https://www.safeway.com',
    includeHttpOnly: true,
  });
  if (!cookies || typeof cookies !== 'object') return undefined;
  const pairs = Object.entries(cookies).filter(
    ([k, v]) => isAllowedSafewayCookieKey(k) && v != null && String(v).length > 0
  );
  if (!pairs.length) return undefined;
  return pairs.map(([k, v]) => `${k}=${String(v)}`).join('; ');
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
    url: 'https://www.safeway.com',
    cookieName: 'SWY_SHARED_SESSION',
    parseToken: (raw) => {
      try {
        const decoded = typeof raw === 'string' ? decodeURIComponent(raw) : raw;
        const j = JSON.parse(decoded);
        return j.accessToken ? { accessToken: j.accessToken } : null;
      } catch {
        return null;
      }
    },
    injectKey: 'accessToken',
    injectVarName: '__injectedAccessToken',
  },
  messageTypes: {
    tokens: 'safeway-tokens',
    debug: 'safeway-webview-fetch-debug',
    progress: 'safeway-progress',
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
});

export const startLogin = bridge.startLogin.bind(bridge);
export const startSilentSync = bridge.startSilentSync.bind(bridge);
export const closeWebViewAfterFetch = bridge.closeWebViewAfterFetch.bind(bridge);
export const getStoredTokens = bridge.getStoredTokens.bind(bridge);
export const hasStoredTokens = bridge.hasStoredTokens.bind(bridge);
export const clearStoredTokens = bridge.clearStoredTokens.bind(bridge);

export { fetchSafewayReceipts } from './safewayApiFetcher';
