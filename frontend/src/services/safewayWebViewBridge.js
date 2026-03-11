/**
 * Safeway WebView Bridge - Orchestrates InAppBrowser for token extraction and receipt fetch.
 * Uses @capgo/inappbrowser for visible login and hidden silent sync modes.
 * Mirrors Costco bridge pattern; tokens stored in @capacitor/preferences.
 */

import { createWebViewBridge } from './webViewBridge';
import { createTokenStorage } from './tokenStorage';
import { getExtractScript } from './safewayExtractScript';

/** Context for pre-extract injection (knownOrderIds, daysOverride). Set by useSafewaySync before startLogin/startSilentSync. */
let preExtractContext = { knownOrderIds: [], daysOverride: 7 };

export function setPreExtractContext(ctx) {
  preExtractContext = { ...preExtractContext, ...ctx };
}

function getPreExtractVars() {
  const ids = JSON.stringify(preExtractContext.knownOrderIds || []);
  const days = preExtractContext.daysOverride ?? 7;
  return `window.__knownOrderIds=${ids};window.__safewayDaysOverride=${days};`;
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
    receipts: 'safeway-receipts',
    tokens: 'safeway-tokens',
    debug: 'safeway-webview-fetch-debug',
    progress: 'safeway-progress',
  },
  tokenStorage,
  extractTokensFromReceiptsMessage: (d) => ({
    accessToken: d.accessToken,
    clubCard: d.clubCard,
  }),
  extractTokensFromTokensMessage: (d) => ({
    accessToken: d.accessToken,
    clubCard: d.clubCard,
  }),
  extractRawReceipts: (d) => d?.receipts ?? [],
  parseReceipts: (raw) => raw.filter(Boolean),
  loginTimeoutMs: 5 * 60 * 1000,
  silentTimeoutMs: 15_000,
  loginTitle: 'Sign in to Safeway',
  preExtractVars: getPreExtractVars,
});

export const startLogin = bridge.startLogin.bind(bridge);
export const startSilentSync = bridge.startSilentSync.bind(bridge);
export const closeWebViewAfterFetch = bridge.closeWebViewAfterFetch.bind(bridge);
export const getStoredTokens = bridge.getStoredTokens.bind(bridge);
export const hasStoredTokens = bridge.hasStoredTokens.bind(bridge);
export const clearStoredTokens = bridge.clearStoredTokens.bind(bridge);
