/**
 * Costco WebView Bridge - Orchestrates InAppBrowser for token extraction
 * Uses @capgo/inappbrowser for visible login and hidden silent sync modes.
 *
 * Token storage: Prefers @capacitor/preferences; falls back to localStorage
 * when Preferences plugin is not available (e.g. "not implemented on android").
 */

import { createWebViewBridge, forceReleaseWebViewSession } from './webViewBridge';
import {
  closeAllKnownInstances,
  getBelievedOpen,
  listKnownInstances,
  reapKnownUnowned,
} from './webViewInstances';
import { createTokenStorage } from './tokenStorage';
import { parseApiReceipt } from './costcoNativeSync';
import { getExtractScript } from './costcoExtractScript';
import {
  getCheckpointEmitScript,
  getPurgeExpiredScript,
  getTokenVerdictScript,
  getTokenWrapInstallScript,
} from './costcoDiagnosticProbe';
import {
  getCostcoLoginTimeoutMs,
  isCostcoDevDiagnosticsEnabled,
  isCostcoDiagnosticPurgeEnabled,
  isCostcoS3SmashArmed,
  consumeCostcoS3SmashFlag,
  restoreCostcoS3SmashFlag,
  clearCostcoS3SmashFlag,
} from './costcoDiagnosticSettings';
import { getSmashRefreshTokenScript } from './costcoS3SmashScript';
import { classifyCostcoSilentResult } from './costcoSilentSyncOutcome';
import { postDevLog } from './apiClient';
import {
  recordCostcoDiagnosticEvent,
  resetCostcoDiagnosticStore,
} from './costcoDiagnosticStore';
import { InAppBrowser } from '@capgo/inappbrowser';
import {
  refreshCostcoTokensAppSide,
  isTerminalRefreshError,
} from './costcoTokenRefresh';

const COSTCO_GRAPHQL_URL = 'https://ecom-api.costco.com/ebusiness/order/v1/orders/graphql';

/** True after S3 smash flag consumed for the current silent session inject loop. */
let s3SmashConsumedThisSession = false;

function buildExtractInstrumentationPrefix() {
  return isCostcoDevDiagnosticsEnabled() ? 'window.__mealdTryPostTrace=1;' : '';
}

function safeRefreshToken(rt) {
  return rt && rt !== 'revoked' ? rt : null;
}

function buildSilentPreExtractVars() {
  if (!isCostcoDevDiagnosticsEnabled()) return null;
  if (s3SmashConsumedThisSession) return getSmashRefreshTokenScript();
  if (!isCostcoS3SmashArmed()) return null;
  consumeCostcoS3SmashFlag();
  s3SmashConsumedThisSession = true;
  postDevLog('costcoSilent', 's3_smash consumed=1');
  return getSmashRefreshTokenScript();
}

/** Wipe dead Costco MSAL cache and reload so cookie SSO can mint a fresh IdToken. Login-only. */
export function getInteractiveMsalRebootstrapScript() {
  return `(function(){
  if(window.__costcoMsalRebootstrap)return;
  window.__costcoMsalRebootstrap=true;
  try{
    function wipe(st){
      try{
        for(var i=st.length-1;i>=0;i--){
          var k=st.key(i);
          if(!k)continue;
          var drop=k.indexOf('msal.')===0||k.indexOf('signin.costco.com')>=0;
          if(!drop){
            try{
              var v=JSON.parse(st.getItem(k));
              if(v&&v.credentialType&&v.environment==='signin.costco.com')drop=true;
            }catch(_){}
          }
          if(drop)st.removeItem(k);
        }
      }catch(_){}
    }
    wipe(localStorage);
    wipe(sessionStorage);
  }catch(_){}
  try{location.reload();}catch(_){}
})();`;
}

export const COSTCO_RECONNECT_COOLDOWN_KEY = 'sync_reconnectCooldown_costco';
const RECONNECT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

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
  extractInstrumentationPrefix: buildExtractInstrumentationPrefix,
  messageTypes: {
    receipts: 'costco-receipts',
    tokens: 'costco-tokens',
    tokenRotated: 'costco-token-rotated',
    silentUnrecoverable: 'costco-silent-unrecoverable',
    appRefreshRequest: 'costco-app-refresh-request',
    debug: 'costco-webview-fetch-debug',
  },
  tokenStorage,
  extractTokensFromReceiptsMessage: (d) => ({
    idToken: d.idToken || d.accessToken,
    accessToken: d.accessToken || null,
    clientID: d.clientID,
    wcsClientId: d.wcsClientId,
    refreshToken: safeRefreshToken(d.refreshToken),
    refreshTokenClientId: d.refreshTokenClientId,
    userAgent: d.userAgent,
  }),
  extractTokensFromTokensMessage: (d) => ({
    idToken: d.idToken || d.accessToken,
    accessToken: d.accessToken || null,
    clientID: d.clientID,
    wcsClientId: d.wcsClientId,
    refreshToken: safeRefreshToken(d.refreshToken),
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
  loginTitle: 'Sign in to Costco',
  urlExcludePattern: 'signin.costco.com',
  /** Do not inject MSAL/receipt polling on SSO hosts (avoids overlay + stale token close during OTP/password). */
  skipInjectionUrlPatterns: [
    'signin.costco.com',
    'b2clogin.com',
    'login.microsoftonline.com',
  ],
  clearSessionBeforeLogin: true,
  loginTimeoutMs: getCostcoLoginTimeoutMs(),
  ...(isCostcoDevDiagnosticsEnabled()
    ? {
        diagnosticProbe: {
          getInstallScript: getTokenWrapInstallScript,
          getCheckpointScript: getCheckpointEmitScript,
          getPurgeScript: getPurgeExpiredScript,
          getVerdictScript: getTokenVerdictScript,
          isPurgeEnabled: isCostcoDiagnosticPurgeEnabled,
          onSessionStart: resetCostcoDiagnosticStore,
          onDiagnosticEvent: recordCostcoDiagnosticEvent,
        },
      }
    : {}),
  cookieProbe: {
    urlPatterns: ['OAuthLogonCmd', 'wcs-err'],
    cookieUrls: ['https://www.costco.com', 'https://signin.costco.com'],
  },
  loopDetection: {
    loopUrlPattern: /wcs-err(?:=|%3d)true/i,
    resetUrlPatterns: [
      'claimsexchange=',
      'fido',
      'SigninPasskey',
      'CombinedSigninAndSignup',
      'NoknokExchange',
    ],
    threshold: 10,
    windowMs: 30000,
    errorMessage:
      'Costco sign-in got stuck in a redirect loop. Please tap Retry to start a clean sign-in.',
    authCompletePatterns: ['CombinedSigninAndSignup/confirmed', 'OAuthLogonCmd'],
    postAuthThreshold: 2,
    postAuthWindowMs: 20000,
    postAuthErrorMessage:
      'Costco signed you in but could not finish connecting your account. Tap Retry to start a clean sign-in.',
  },
  silentAppRefresh: async () => {
    const stored = await tokenStorage.get();
    if (!stored.refreshToken) return null;
    const idToken = stored.idToken || stored.accessToken;
    if (!idToken) return null;
    try {
      const refreshed = await refreshCostcoTokensAppSide({
        refreshToken: stored.refreshToken,
        idToken,
        refreshTokenClientId: stored.refreshTokenClientId,
      });
      await tokenStorage.store({
        idToken: refreshed.idToken,
        refreshToken: refreshed.refreshToken,
        refreshTokenClientId: stored.refreshTokenClientId,
        accessToken: refreshed.accessToken || stored.accessToken || null,
      });
      return refreshed;
    } catch (err) {
      if (isTerminalRefreshError(err)) {
        await tokenStorage.store({
          refreshToken: null,
          refreshTokenClientId: null,
        });
      }
      throw err;
    }
  },
  isTerminalAppRefreshError: isTerminalRefreshError,
  silentPreExtractVars: buildSilentPreExtractVars,
  interactiveUnrecoverableScript: getInteractiveMsalRebootstrapScript(),
});

export async function startLogin() {
  clearCostcoS3SmashFlag();
  s3SmashConsumedThisSession = false;
  return bridge.startLogin();
}

export async function startSilentSync() {
  s3SmashConsumedThisSession = false;
  try {
    const result = await bridge.startSilentSync();
    const kind = classifyCostcoSilentResult(result);
    if (s3SmashConsumedThisSession) {
      postDevLog('costcoSilent', `s3_result kind=${kind ?? 'null'}`);
      if (kind !== 'needs_reconnect') {
        restoreCostcoS3SmashFlag();
      }
    }
    return result;
  } catch (err) {
    if (s3SmashConsumedThisSession) {
      restoreCostcoS3SmashFlag();
    }
    throw err;
  } finally {
    s3SmashConsumedThisSession = false;
  }
}
export const closeWebViewAfterFetch = bridge.closeWebViewAfterFetch.bind(bridge);
export const getStoredTokens = bridge.getStoredTokens.bind(bridge);
export const hasStoredTokens = bridge.hasStoredTokens.bind(bridge);
export const clearStoredTokens = bridge.clearStoredTokens.bind(bridge);

/** Mark Costco silent sync suppressed until cooldown expires or interactive connect succeeds. */
export async function setCostcoReconnectCooldown() {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({
      key: COSTCO_RECONNECT_COOLDOWN_KEY,
      value: String(Date.now() + RECONNECT_COOLDOWN_MS),
    });
  } catch {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(COSTCO_RECONNECT_COOLDOWN_KEY, String(Date.now() + RECONNECT_COOLDOWN_MS));
    }
  }
}

/** Clear reconnect cooldown after a successful interactive connect. */
export async function clearCostcoReconnectCooldown() {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.remove({ key: COSTCO_RECONNECT_COOLDOWN_KEY });
  } catch {
    /* ignore */
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(COSTCO_RECONNECT_COOLDOWN_KEY);
  }
}

/** @returns {Promise<boolean>} true if silent sync should be skipped due to reconnect cooldown */
export async function isCostcoReconnectCooldownActive() {
  let raw = null;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: COSTCO_RECONNECT_COOLDOWN_KEY });
    raw = value;
  } catch {
    if (typeof localStorage !== 'undefined') {
      raw = localStorage.getItem(COSTCO_RECONNECT_COOLDOWN_KEY);
    }
  }
  if (!raw) return false;
  const until = Number(raw);
  if (!until || Number.isNaN(until)) return false;
  return Date.now() < until;
}

/** Clears InAppBrowser cookie jar + disk cache (reduces stale B2C / Akamai state after failures). Safe to call from error handlers. */
export async function clearCostcoInAppBrowserSession() {
  forceReleaseWebViewSession();
  await reapKnownUnowned('manual_clear', 'costco', 'login');
  if (getBelievedOpen()) {
    await InAppBrowser.close().catch(() => {});
  }
  await closeAllKnownInstances();
  await InAppBrowser.clearAllCookies({}).catch((e) => console.warn('[costcoWebViewBridge] clearAllCookies:', e?.message ?? e));
  await InAppBrowser.clearCache({}).catch((e) => console.warn('[costcoWebViewBridge] clearCache:', e?.message ?? e));
}

if (isCostcoDevDiagnosticsEnabled() && typeof window !== 'undefined') {
  window.__mealdWebViews = {
    list: () => listKnownInstances(),
    closeAll: () => clearCostcoInAppBrowserSession(),
  };
}
