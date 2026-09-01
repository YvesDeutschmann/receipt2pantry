/**
 * useCostcoSync - React hook for One-Tap Costco sync flow
 * Orchestrates: token check -> login (WebView) -> in-WebView receipt fetch -> backend handoff
 */

import { useState, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { hasStoredTokens, startLogin, startSilentSync, clearStoredTokens, clearCostcoInAppBrowserSession, clearCostcoReconnectCooldown } from '../services/costcoWebViewBridge';
import { submitToBackend } from '../services/costcoNativeSync';
import { submitSilentReceipts } from '../services/costcoSilentIngest';
import { api } from '../services/apiClient';
import { dispatchProviderSyncCompleted } from '../services/providerSyncEvents';
import {
  COSTCO_RECONNECT_MESSAGE,
  COSTCO_FETCH_MISS_MESSAGE,
  classifyCostcoSilentResult,
  isTransientCostcoFailure,
} from '../services/costcoSilentSyncOutcome';
import {
  logPhase,
  reportAnomaly,
  SyncPhase,
} from '../services/syncEventLog';

const LOG_PREFIX = '[CostcoSync]';
const STATUS = {
  IDLE: 'idle',
  AUTHENTICATING: 'authenticating',
  FETCHING: 'fetching',
  SUBMITTING: 'submitting',
  SUCCESS: 'success',
  ERROR: 'error',
};

export function useCostcoSync(userId) {
  const [status, setStatus] = useState(STATUS.IDLE);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [hasStoredTokensState, setHasStoredTokensState] = useState(false);

  const checkStoredTokens = useCallback(async () => {
    const has = await hasStoredTokens();
    setHasStoredTokensState(has);
    return has;
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
    try {
      setStatus(STATUS.AUTHENTICATING);
      tokens = await startLogin();
      console.log(`${LOG_PREFIX} startSync: login complete, tokens obtained`);

      setStatus(STATUS.FETCHING);
      let receipts;

      if (tokens?.receipts != null && tokens?._fromWebView) {
        receipts = tokens.receipts;
        console.log(`${LOG_PREFIX} Using ${receipts?.length ?? 0} receipts from in-WebView fetch`);
      } else if (tokens?._closeWebViewAfterFetch) {
        throw new Error('Could not fetch receipts. Please try again and navigate to Orders & Purchases in Costco.');
      } else {
        throw new Error('In-WebView fetch did not return receipts. Please try again after signing in.');
      }

      if (!userId) {
        setResult({ receipts, count: receipts.length, receipts_stored: 0, items_added_to_pantry: 0 });
        dispatchProviderSyncCompleted('costco', {
          tier: 'manual',
          receipts_stored: 0,
          items_added: 0,
        });
        setStatus(STATUS.SUCCESS);
        return;
      }

      setStatus(STATUS.SUBMITTING);
      void logPhase('costco', SyncPhase.INGEST_STARTED, { mode: 'login' });
      let finalBackend;
      try {
        finalBackend = await submitToBackend(receipts, userId);
      } catch (ingestErr) {
        void reportAnomaly('costco', SyncPhase.INGEST_FAILED, {
          mode: 'login',
          reason: ingestErr?.message || String(ingestErr),
        });
        throw ingestErr;
      }
      const itemsAddedCostco = finalBackend.items_added_to_pantry ?? 0;
      if (itemsAddedCostco > 3) {
        void api.suggestions
          .triggerGeneration(userId, { triggerReason: 'receipt_scan' })
          .catch(() => {});
      }
      if (userId && tokens) {
        try {
          await api.connectCostcoFromApp(userId, tokens);
          await clearCostcoReconnectCooldown();
        } catch (connectErr) {
          console.warn(`${LOG_PREFIX} connect-from-app failed (tokens not stored on backend):`, connectErr?.message || connectErr);
        }
      }
      setResult({
        receipts,
        count: receipts.length,
        receipts_stored: finalBackend.receipts_stored ?? receipts.length,
        items_added_to_pantry: itemsAddedCostco,
        errors: finalBackend.errors,
      });
      dispatchProviderSyncCompleted('costco', {
        tier: 'manual',
        receipts_stored: finalBackend.receipts_stored ?? receipts.length,
        items_added: itemsAddedCostco,
      });
      void logPhase('costco', SyncPhase.SYNC_SUCCEEDED, {
        mode: 'login',
        metadata: {
          receipts_stored: finalBackend.receipts_stored ?? receipts.length,
          items_added: itemsAddedCostco,
        },
      });
      setStatus(STATUS.SUCCESS);
      setHasStoredTokensState(true);
    } catch (err) {
      const msg = err?.message || String(err);
      const isTokenError = /token.*invalid|token.*expired|401|403|65535|in-webview fetch/i.test(msg);
      const isLoopError = /redirect loop|stuck in a redirect loop|finish connecting your account/i.test(msg);
      console.error(`${LOG_PREFIX} startSync failed`, err?.message || err, err);
      void reportAnomaly('costco', SyncPhase.SYNC_FAILED, {
        mode: 'login',
        reason: msg,
      });
      if (isTokenError || isLoopError) {
        await clearStoredTokens();
        await clearCostcoInAppBrowserSession().catch(() => {});
        setHasStoredTokensState(false);
      }
      setError(msg);
      setStatus(STATUS.ERROR);
    }
  }, [userId]);

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
      const outcome = classifyCostcoSilentResult(result);

      if (outcome === 'skipped') {
        setStatus(STATUS.IDLE);
        return;
      }

      if (outcome === 'timeout') {
        setError('Sync timed out. Check your connection and try again.');
        setStatus(STATUS.ERROR);
        return;
      }

      if (outcome === 'needs_reconnect') {
        await clearStoredTokens();
        await clearCostcoInAppBrowserSession().catch(() => {});
        setHasStoredTokensState(false);
        setError(COSTCO_RECONNECT_MESSAGE);
        setStatus(STATUS.ERROR);
        window.dispatchEvent(new CustomEvent('costco-sync-needs-reconnect'));
        return;
      }

      if (outcome === 'tokens_only') {
        setError(COSTCO_FETCH_MISS_MESSAGE);
        setStatus(STATUS.ERROR);
        return;
      }

      const receipts = result.receipts ?? [];
      if (receipts.length > 0) {
        setStatus(STATUS.SUBMITTING);
        void logPhase('costco', SyncPhase.INGEST_STARTED, { mode: 'silent' });
        let finalBackend;
        try {
          finalBackend = await submitSilentReceipts(receipts, userId, {
            getCurrentUserId: () => userId,
          });
        } catch (ingestErr) {
          void reportAnomaly('costco', SyncPhase.INGEST_FAILED, {
            mode: 'silent',
            reason: ingestErr?.message || String(ingestErr),
          });
          throw ingestErr;
        }
        const itemsAddedSilent = finalBackend.items_added_to_pantry ?? 0;
        if (itemsAddedSilent > 3) {
          void api.suggestions
            .triggerGeneration(userId, { triggerReason: 'receipt_scan' })
            .catch(() => {});
        }
        if (result.idToken || result.accessToken) {
          try {
            await api.connectCostcoFromApp(userId, result);
            await clearCostcoReconnectCooldown();
          } catch (connectErr) {
            console.warn(`${LOG_PREFIX} connect-from-app failed (silent sync):`, connectErr?.message || connectErr);
          }
        }
        setResult({
          receipts,
          count: receipts.length,
          receipts_stored: finalBackend.receipts_stored ?? receipts.length,
          items_added_to_pantry: itemsAddedSilent,
          errors: finalBackend.errors,
        });
        dispatchProviderSyncCompleted('costco', {
          tier: 'silent',
          receipts_stored: finalBackend.receipts_stored ?? receipts.length,
          items_added: itemsAddedSilent,
        });
        void logPhase('costco', SyncPhase.SYNC_SUCCEEDED, {
          mode: 'silent',
          metadata: {
            receipts_stored: finalBackend.receipts_stored ?? receipts.length,
            items_added: itemsAddedSilent,
          },
        });
        setStatus(STATUS.SUCCESS);
        setHasStoredTokensState(true);
      } else {
        setError('No new Costco receipts found.');
        setStatus(STATUS.ERROR);
      }
    } catch (err) {
      const msg = err?.message || String(err);
      console.error(`${LOG_PREFIX} startSilent failed`, msg);
      void reportAnomaly('costco', SyncPhase.SYNC_FAILED, {
        mode: 'silent',
        reason: msg,
      });
      if (!isTransientCostcoFailure(err)) {
        await clearStoredTokens();
        await clearCostcoInAppBrowserSession().catch(() => {});
        setHasStoredTokensState(false);
      }
      setError(msg || 'Failed to fetch receipts.');
      setStatus(STATUS.ERROR);
    }
  }, [userId]);

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
