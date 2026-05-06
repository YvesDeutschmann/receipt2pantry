/**
 * Costco WebView Bridge - Orchestrates InAppBrowser for token extraction
 * Uses @capgo/inappbrowser for visible login and hidden silent sync modes.
 *
 * Token storage: Prefers @capacitor/preferences; falls back to localStorage
 * when Preferences plugin is not available (e.g. "not implemented on android").
 */

import { createWebViewBridge } from './webViewBridge';
import { createTokenStorage } from './tokenStorage';
import { parseApiReceipt } from './costcoNativeSync';
import { getExtractScript } from './costcoExtractScript';
import { InAppBrowser } from '@capgo/inappbrowser';

const COSTCO_GRAPHQL_URL = 'https://ecom-api.costco.com/ebusiness/order/v1/orders/graphql';

const tokenStorage = createTokenStorage({
  prefKeys: {
    idToken: 'costco_idToken',
    accessToken: 'costco_accessToken',
    clientID: 'costco_clientID',
    wcsClientId: 'costco_wcsClientId',
    userAgent: 'costco_userAgent',
    refreshToken: 'costco_refreshToken',
    refreshTokenClientId: 'costco_refreshTokenClientId',
  },
  secureKeys: {
    refreshToken: 'costco_refreshToken_secure',
    refreshTokenClientId: 'costco_refreshTokenClientId_secure',
  },
  localStoragePrefix: 'costco_',
  hasCheckKeys: ['idToken', 'accessToken'],
});

const bridge = createWebViewBridge({
  provider: 'costco',
  loginUrl: 'https://www.costco.com',
  homeUrl: 'https://www.costco.com',
  extractDomains: ['costco.com', 'signin.costco.com', 'login.microsoftonline.com', 'b2clogin.com'],
  getExtractScript: () => getExtractScript(COSTCO_GRAPHQL_URL),
  messageTypes: {
    receipts: 'costco-receipts',
    tokens: 'costco-tokens',
    debug: 'costco-webview-fetch-debug',
  },
  tokenStorage,
  extractTokensFromReceiptsMessage: (d) => ({
    idToken: d.idToken || d.accessToken,
    accessToken: d.accessToken || null,
    clientID: d.clientID,
    wcsClientId: d.wcsClientId,
    refreshToken: d.refreshToken,
    refreshTokenClientId: d.refreshTokenClientId,
    userAgent: d.userAgent,
  }),
  extractTokensFromTokensMessage: (d) => ({
    idToken: d.idToken || d.accessToken,
    accessToken: d.accessToken || null,
    clientID: d.clientID,
    wcsClientId: d.wcsClientId,
    refreshToken: d.refreshToken,
    refreshTokenClientId: d.refreshTokenClientId,
    userAgent: d.userAgent,
  }),
  extractRawReceipts: (d) => d?.receipts ?? [],
  parseReceipts: (raw) => raw.map((r) => parseApiReceipt(r)).filter(Boolean),
  filterReceipts: (raw) =>
    raw.filter((r) => {
      const normalized = String(r.receiptType || '')
        .replace(/[\s-]/g, '')
        .toLowerCase();
      return (
        normalized !== 'gasstation' &&
        normalized !== 'carwash' &&
        normalized !== 'gasandcarwash'
      );
    }),
  /**
   * Capture the CAPGO mobileApp bridge reference as early as possible, before
   * www.costco.com's own native-app bridge code can assign window.mobileApp.
   * The extract script uses window.__capgoBridge (falling back to window.mobileApp)
   * so our postMessage calls always reach the Capacitor layer, not Costco's bridge.
   */
  preExtractVars: () =>
    `if(!window.__capgoBridge&&window.mobileApp&&typeof window.mobileApp.postMessage==='function'){window.__capgoBridge=window.mobileApp;}`,
  loginTitle: 'Sign in to Costco',
  urlExcludePattern: 'signin.costco.com',
  /** Do not inject MSAL/receipt polling on SSO hosts (avoids overlay + stale token close during OTP/password). */
  skipInjectionUrlPatterns: [
    'signin.costco.com',
    'b2clogin.com',
    'login.microsoftonline.com',
  ],
});

export const startLogin = bridge.startLogin.bind(bridge);
export const startSilentSync = bridge.startSilentSync.bind(bridge);
export const closeWebViewAfterFetch = bridge.closeWebViewAfterFetch.bind(bridge);
export const getStoredTokens = bridge.getStoredTokens.bind(bridge);
export const hasStoredTokens = bridge.hasStoredTokens.bind(bridge);
export const clearStoredTokens = bridge.clearStoredTokens.bind(bridge);

/** Clears InAppBrowser cookie jar + disk cache (reduces stale B2C / Akamai state after failures). Safe to call from error handlers. */
export async function clearCostcoInAppBrowserSession() {
  await InAppBrowser.close().catch(() => {});
  await InAppBrowser.clearAllCookies({}).catch((e) => console.warn('[costcoWebViewBridge] clearAllCookies:', e?.message ?? e));
  await InAppBrowser.clearCache({}).catch((e) => console.warn('[costcoWebViewBridge] clearCache:', e?.message ?? e));
}
