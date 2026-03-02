/**
 * useCostcoSync - React hook for One-Tap Costco sync flow
 * Orchestrates: token check -> login (WebView) -> in-WebView receipt fetch -> backend handoff
 */

import { useState, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { getStoredTokens, hasStoredTokens, startLogin, startSilentSync, clearStoredTokens } from './costcoWebViewBridge';
import { isTokenExpired, submitToBackend } from './costcoNativeSync';
import { log as debugLog } from './debugLogger';
import { api } from '../src/services/apiClient';

const LOG_PREFIX = '[CostcoSync]';
const STATUS = {
  IDLE: 'idle',
  AUTHENTICATING: 'authenticating',
  FETCHING: 'fetching',
  SUBMITTING: 'submitting',
  SUCCESS: 'success',
  ERROR: 'error',
};

export function useCostcoSync(userId, options = {}) {
  const { days = 90, apiBaseUrl } = options;
  const [status, setStatus] = useState(STATUS.IDLE);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [hasStoredTokensState, setHasStoredTokensState] = useState(false);

  const checkStoredTokens = useCallback(async () => {
    const has = await hasStoredTokens();
    setHasStoredTokensState(has);
    return has;
  }, []);

  const getValidTokens = useCallback(async () => {
    const stored = await getStoredTokens();
    const tokenForExpiry = stored?.idToken || stored?.accessToken;
    const expired = tokenForExpiry ? isTokenExpired(tokenForExpiry) : 'n/a';
    // #region agent log
    debugLog('useCostcoSync.js:getValidTokens', 'getValidTokens', { hasIdToken: Boolean(stored?.idToken), hasAccessToken: Boolean(stored?.accessToken), expired, hasRefreshToken: Boolean(stored?.refreshToken) }, 'H1');
    // #endregion
    console.log(`${LOG_PREFIX} getValidTokens: hasStored=${Boolean(tokenForExpiry)}, expired=${expired}`);
    if (!stored?.idToken && !stored?.accessToken) return null;
    if (tokenForExpiry && !isTokenExpired(tokenForExpiry)) {
      return {
        idToken: stored.idToken,
        accessToken: stored.accessToken,
        clientID: stored.clientID,
        refreshToken: stored.refreshToken,
        refreshTokenClientId: stored.refreshTokenClientId,
        userAgent: stored.userAgent,
      };
    }
    return null;
  }, []);

  const startSync = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      setError('One-Tap Sync requires a native app (iOS/Android). Run on device or emulator.');
      setStatus(STATUS.ERROR);
      return;
    }

    setError(null);
    setResult(null);

    let tokens = null;
    let nativeReturned403 = false;
    try {
      // Always open WebView - receipts are fetched in-WebView when user navigates to Order & Purchases
      setStatus(STATUS.AUTHENTICATING);
      tokens = await startLogin();
      debugLog('useCostcoSync.js:startSync', 'Login complete', { hasIdToken: Boolean(tokens?.idToken), hasReceipts: Boolean(tokens?.receipts) }, 'H3');
      console.log(`${LOG_PREFIX} startSync: login complete, tokens obtained`);

      setStatus(STATUS.FETCHING);
      let receipts;

      if (tokens?.receipts != null && tokens?._fromWebView) {
        receipts = tokens.receipts;
        debugLog('useCostcoSync.js:receiptsFromWebView', 'Using receipts from in-WebView fetch', { count: receipts?.length ?? 0 }, 'H3');
        console.log(`${LOG_PREFIX} Using ${receipts?.length ?? 0} receipts from in-WebView fetch`);
      } else if (tokens?._closeWebViewAfterFetch && userId) {
        // Fallback: GraphQL may have failed in WebView (403 from signin.costco.com). Use backend fetch-with-token.
        debugLog('useCostcoSync.js:fallbackBackendFetch', 'Tokens only, trying fetch-receipts-with-token', {}, 'H3');
        try {
          const response = await api.fetchCostcoReceiptsWithToken(tokens, userId, days);
          receipts = response.receipts || [];
          debugLog('useCostcoSync.js:fallbackSuccess', 'Backend fetch-with-token succeeded', { count: receipts.length }, 'H3');
          console.log(`${LOG_PREFIX} Fallback: fetched ${receipts.length} receipts via backend (fetch-receipts-with-token)`);
          // Backend already stored receipts; skip submitToBackend
          setStatus(STATUS.SUBMITTING);
          if (userId && tokens) {
            try {
              await api.connectCostcoFromApp(userId, tokens);
            } catch (connectErr) {
              console.warn(`${LOG_PREFIX} connect-from-app failed:`, connectErr?.message || connectErr);
            }
          }
          setResult({
            receipts,
            count: receipts.length,
            receipts_stored: response.receipts_stored ?? receipts.length,
            items_added_to_pantry: response.items_added_to_pantry ?? 0,
            errors: response.errors,
          });
          setStatus(STATUS.SUCCESS);
          setHasStoredTokensState(true);
          return;
        } catch (fallbackErr) {
          const msg = fallbackErr?.response?.data?.error || fallbackErr?.message || String(fallbackErr);
          throw new Error(`In-WebView fetch did not return receipts. Backend fallback failed: ${msg}`);
        }
      } else {
        throw new Error('In-WebView fetch did not return receipts. Please try again after signing in.');
      }

      if (!userId) {
        setResult({ receipts, count: receipts.length, receipts_stored: 0, items_added_to_pantry: 0 });
        setStatus(STATUS.SUCCESS);
        return;
      }

      setStatus(STATUS.SUBMITTING);
      const finalBackend = await submitToBackend(receipts, userId, apiBaseUrl);
      if (userId && tokens) {
        try {
          await api.connectCostcoFromApp(userId, tokens);
        } catch (connectErr) {
          console.warn(`${LOG_PREFIX} connect-from-app failed (tokens not stored on backend):`, connectErr?.message || connectErr);
        }
      }
      setResult({
        receipts,
        count: receipts.length,
        receipts_stored: finalBackend.receipts_stored ?? receipts.length,
        items_added_to_pantry: finalBackend.items_added_to_pantry ?? 0,
        errors: finalBackend.errors,
      });
      setStatus(STATUS.SUCCESS);
      setHasStoredTokensState(true);
    } catch (err) {
      const msg = err?.message || String(err);
      const isTokenError = /token.*invalid|token.*expired|401|403|65535|in-webview fetch/i.test(msg) || nativeReturned403;
      // #region agent log
      debugLog('useCostcoSync.js:startSyncFailed', 'startSync failed', { errMsg: msg, isTokenError, willClearTokens: isTokenError }, 'H2');
      // #endregion
      console.error(`${LOG_PREFIX} startSync failed`, err?.message || err, err);
      if (isTokenError) {
        await clearStoredTokens();
        setHasStoredTokensState(false);
      }
      setError(msg);
      setStatus(STATUS.ERROR);
    }
  }, [userId, days, apiBaseUrl]);

  const startSilent = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      setError('One-Tap Sync requires a native app.');
      setStatus(STATUS.ERROR);
      return;
    }
    if (!userId) {
      setError('Please sign in to sync receipts.');
      setStatus(STATUS.ERROR);
      return;
    }

    setError(null);
    setResult(null);

    try {
      setStatus(STATUS.FETCHING);
      const result = await startSilentSync();
      if (!result) {
        await clearStoredTokens();
        setHasStoredTokensState(false);
        setError('Costco session expired. Please sign in again.');
        setStatus(STATUS.ERROR);
        return;
      }

      const receipts = result.receipts ?? [];
      if (receipts.length > 0) {
        setStatus(STATUS.SUBMITTING);
        const finalBackend = await submitToBackend(receipts, userId, apiBaseUrl);
        if (result.idToken || result.accessToken) {
          try {
            await api.connectCostcoFromApp(userId, result);
          } catch (connectErr) {
            console.warn(`${LOG_PREFIX} connect-from-app failed (silent sync):`, connectErr?.message || connectErr);
          }
        }
        setResult({
          receipts,
          count: receipts.length,
          receipts_stored: finalBackend.receipts_stored ?? receipts.length,
          items_added_to_pantry: finalBackend.items_added_to_pantry ?? 0,
          errors: finalBackend.errors,
        });
      } else {
        setResult({
          receipts: [],
          count: 0,
          receipts_stored: 0,
          items_added_to_pantry: 0,
          errors: [],
        });
      }
      setStatus(STATUS.SUCCESS);
      setHasStoredTokensState(true);
    } catch (err) {
      const msg = err?.message || String(err);
      debugLog('useCostcoSync.js:startSilentFailed', 'startSilent failed', { errMsg: msg }, 'H2');
      await clearStoredTokens();
      setHasStoredTokensState(false);
      setError(msg || 'Failed to fetch receipts.');
      setStatus(STATUS.ERROR);
    }
  }, [userId, apiBaseUrl]);

  return {
    status,
    error,
    result,
    startSync,
    startSilent,
    hasStoredTokens: hasStoredTokensState,
    checkStoredTokens,
    isNative: Capacitor.isNativePlatform(),
  };
}

export { STATUS };
