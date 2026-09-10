/**
 * useCostcoSync - React hook for One-Tap Costco sync flow
 * Orchestrates: token check -> login (WebView) -> in-WebView receipt fetch -> backend handoff
 */

import { useState, useCallback, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { hasStoredTokens, startLogin, startSilentSync, clearStoredTokens, clearCostcoInAppBrowserSession, clearCostcoReconnectCooldown } from '../services/costcoWebViewBridge';
import { submitToBackend } from '../services/costcoNativeSync';
import { submitSilentReceipts } from '../services/costcoSilentIngest';
import { api } from '../services/apiClient';
import { dispatchProviderSyncCompleted, dispatchProviderSyncFailed } from '../services/providerSyncEvents';
import { classifySyncFailure } from '../services/syncOutcomeClassifier';
import {
  COSTCO_RECONNECT_MESSAGE,
  COSTCO_FETCH_MISS_MESSAGE,
  isTransientCostcoFailure,
} from '../services/costcoSilentSyncOutcome';
import { mapCostcoSilentToOutcome, SYNC_OUTCOMES } from '../services/syncOutcomeMapper';
import {
  logPhase,
  reportAnomaly,
  SyncPhase,
} from '../services/syncEventLog';
import { writeLastRun } from '../services/syncPrefKeys';

const LOG_PREFIX = '[CostcoSync]';

function dispatchCatchSyncOutcome(err, msg) {
  const failureKind = classifySyncFailure({
    status: err?.status,
    reason: err?.reason,
    message: msg,
  });
  if (failureKind === 'expired') {
    window.dispatchEvent(new CustomEvent('costco-sync-needs-reconnect'));
  } else {
    dispatchProviderSyncFailed('costco', { reason: err?.reason, message: msg });
  }
}

const STATUS = {
  IDLE: 'idle',
  AUTHENTICATING: 'authenticating',
  FETCHING: 'fetching',
  SUBMITTING: 'submitting',
  SUCCESS: 'success',
  ERROR: 'error',
  SKIPPED: 'skipped',
};

export function useCostcoSync(userId) {
  const [status, setStatus] = useState(STATUS.IDLE);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [hasStoredTokensState, setHasStoredTokensState] = useState(false);

  useEffect(() => {
    if (status !== STATUS.SKIPPED) return undefined;
    const events = [
      'costco-sync-completed',
      'costco-sync-error',
      'costco-sync-needs-reconnect',
    ];
    const onTerminal = () => {
      setStatus((s) => (s === STATUS.SKIPPED ? STATUS.IDLE : s));
    };
    for (const name of events) window.addEventListener(name, onTerminal);
    return () => {
      for (const name of events) window.removeEventListener(name, onTerminal);
    };
  }, [status]);

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

      const mapped = mapCostcoSilentToOutcome({ ...tokens, receipts, _fromWebView: true });

      if (mapped.outcome === SYNC_OUTCOMES.FAILED) {
        const msg =
          mapped.reason === 'silent_timeout'
            ? 'Sync timed out. Check your connection and try again.'
            : COSTCO_FETCH_MISS_MESSAGE;
        setError(msg);
        setStatus(STATUS.ERROR);
        dispatchProviderSyncFailed('costco', { reason: mapped.reason, message: msg });
        return;
      }

      if (!userId) {
        const outcomeReceipts = mapped.receipts ?? receipts;
        setResult({
          receipts: outcomeReceipts,
          count: outcomeReceipts.length,
          receipts_stored: 0,
          items_added_to_pantry: 0,
        });
        await writeLastRun('costco');
        await clearCostcoReconnectCooldown();
        dispatchProviderSyncCompleted('costco', {
          tier: 'manual',
          receipts_stored: 0,
          items_added: 0,
          outcome: mapped.outcome,
        });
        setStatus(STATUS.SUCCESS);
        return;
      }

      if (mapped.outcome === SYNC_OUTCOMES.COMPLETED_EMPTY) {
        setResult({
          receipts: [],
          count: 0,
          receipts_stored: 0,
          items_added_to_pantry: 0,
        });
        await writeLastRun('costco');
        await clearCostcoReconnectCooldown();
        dispatchProviderSyncCompleted('costco', {
          tier: 'manual',
          receipts_stored: 0,
          items_added: 0,
          outcome: SYNC_OUTCOMES.COMPLETED_EMPTY,
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
      await writeLastRun('costco');
      await clearCostcoReconnectCooldown();
      dispatchProviderSyncCompleted('costco', {
        tier: 'manual',
        receipts_stored: finalBackend.receipts_stored ?? receipts.length,
        items_added: itemsAddedCostco,
        outcome: mapped.outcome,
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
      const isTokenError =
        classifySyncFailure({
          status: err?.status,
          reason: err?.reason,
          message: msg,
        }) === 'expired' || /65535|in-webview fetch/i.test(msg);
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
      dispatchCatchSyncOutcome(err, msg);
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
      const mapped = mapCostcoSilentToOutcome(result);

      if (mapped.outcome === SYNC_OUTCOMES.SKIPPED) {
        setStatus(STATUS.SKIPPED);
        return;
      }

      if (mapped.outcome === SYNC_OUTCOMES.FAILED) {
        const msg =
          mapped.reason === 'silent_timeout'
            ? 'Sync timed out. Check your connection and try again.'
            : COSTCO_FETCH_MISS_MESSAGE;
        setError(msg);
        setStatus(STATUS.ERROR);
        dispatchProviderSyncFailed('costco', { reason: mapped.reason, message: msg });
        return;
      }

      if (mapped.outcome === SYNC_OUTCOMES.NEEDS_RECONNECT) {
        await clearStoredTokens();
        await clearCostcoInAppBrowserSession().catch(() => {});
        setHasStoredTokensState(false);
        setError(COSTCO_RECONNECT_MESSAGE);
        setStatus(STATUS.ERROR);
        window.dispatchEvent(new CustomEvent('costco-sync-needs-reconnect'));
        return;
      }

      const receipts = mapped.receipts ?? [];
      if (mapped.outcome === SYNC_OUTCOMES.COMPLETED_EMPTY) {
        setResult({
          receipts: [],
          count: 0,
          receipts_stored: 0,
          items_added_to_pantry: 0,
        });
        await writeLastRun('costco');
        await clearCostcoReconnectCooldown();
        dispatchProviderSyncCompleted('costco', {
          tier: 'silent',
          receipts_stored: 0,
          items_added: 0,
          outcome: SYNC_OUTCOMES.COMPLETED_EMPTY,
        });
        void logPhase('costco', SyncPhase.SYNC_SUCCEEDED, {
          mode: 'silent',
          metadata: { receipts_stored: 0, items_added: 0, outcome: SYNC_OUTCOMES.COMPLETED_EMPTY },
        });
        setStatus(STATUS.SUCCESS);
        setHasStoredTokensState(true);
        return;
      }

      if (receipts.length > 0) {
        setStatus(STATUS.SUBMITTING);
        void logPhase('costco', SyncPhase.INGEST_STARTED, { mode: 'silent' });
        let finalBackend;
        try {
          finalBackend = await submitSilentReceipts(receipts, userId, {
            getCurrentUserId: () => userId,
          });
        } catch (ingestErr) {
          const ingestMsg = ingestErr?.message || String(ingestErr);
          void reportAnomaly('costco', SyncPhase.INGEST_FAILED, {
            mode: 'silent',
            reason: ingestMsg,
          });
          const ingestFailureKind = classifySyncFailure({
            status: ingestErr?.status,
            reason: ingestErr?.reason,
            message: ingestMsg,
          });
          if (ingestFailureKind === 'expired') {
            await clearStoredTokens();
            await clearCostcoInAppBrowserSession().catch(() => {});
            setHasStoredTokensState(false);
            setError(COSTCO_RECONNECT_MESSAGE);
            setStatus(STATUS.ERROR);
            window.dispatchEvent(new CustomEvent('costco-sync-needs-reconnect'));
            return;
          }
          dispatchProviderSyncFailed('costco', { reason: ingestErr?.reason, message: ingestMsg });
          setError(ingestMsg);
          setStatus(STATUS.ERROR);
          return;
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
        await writeLastRun('costco');
        await clearCostcoReconnectCooldown();
        dispatchProviderSyncCompleted('costco', {
          tier: 'silent',
          receipts_stored: finalBackend.receipts_stored ?? receipts.length,
          items_added: itemsAddedSilent,
          outcome: SYNC_OUTCOMES.COMPLETED_ITEMS,
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
      dispatchCatchSyncOutcome(err, msg || 'Failed to fetch receipts.');
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
