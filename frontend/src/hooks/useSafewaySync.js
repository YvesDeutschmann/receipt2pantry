/**
 * useSafewaySync - React hook for Safeway sync flow
 * WebView extracts token + clubCard; app-layer fetch (safewayApiFetcher) + ingest.
 */

import { useState, useCallback, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  hasStoredTokens,
  startLogin,
  startSilentSync,
  clearStoredTokens,
  fetchSafewayReceipts,
  clearSafewayReconnectCooldown,
} from '../services/safewayWebViewBridge';
import { parseSafewayReceipt } from '../services/safewayReceiptParser';
import { api } from '../services/apiClient';
import {
  dispatchProviderSyncCompleted,
  dispatchProviderSyncFailed,
} from '../services/providerSyncEvents';
import { classifySyncFailure } from '../services/syncOutcomeClassifier';
import {
  classifySafewaySilentResult,
  SAFEWAY_RECONNECT_MESSAGE,
  SAFEWAY_TIMEOUT_MESSAGE,
  SAFEWAY_MISSING_CLUB_MESSAGE,
} from '../services/safewaySilentSyncOutcome';
import { mapSafewaySilentToOutcome, SYNC_OUTCOMES } from '../services/syncOutcomeMapper';
import {
  logPhase,
  reportAnomaly,
  SyncPhase,
} from '../services/syncEventLog';
import { writeLastRun } from '../services/syncPrefKeys';

const LOG_PREFIX = '[SafewaySync]';

function dispatchCatchSyncOutcome(err, msg) {
  const failureKind = classifySyncFailure({
    status: err?.status,
    reason: err?.reason,
    message: msg,
  });
  if (failureKind === 'expired') {
    window.dispatchEvent(new CustomEvent('safeway-sync-needs-reconnect'));
  } else {
    dispatchProviderSyncFailed('safeway', { reason: err?.reason, message: msg });
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

async function handleFetchAuthError(err, clearTokens) {
  if (
    classifySyncFailure({
      status: err?.status,
      reason: err?.reason,
      message: err?.message,
    }) === 'expired'
  ) {
    await clearTokens();
    return true;
  }
  return false;
}

export function useSafewaySync(userId) {
  const [status, setStatus] = useState(STATUS.IDLE);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [hasStoredTokensState, setHasStoredTokensState] = useState(false);
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    const handler = (e) => {
      const d = e?.detail;
      if (d && (d.step || d.current != null || d.total != null)) {
        setProgress({ step: d.step, current: d.current ?? 0, total: d.total ?? 0 });
      }
    };
    window.addEventListener('webview-progress', handler);
    return () => window.removeEventListener('webview-progress', handler);
  }, []);

  useEffect(() => {
    if (status !== STATUS.SKIPPED) return undefined;
    const events = [
      'safeway-sync-completed',
      'safeway-sync-error',
      'safeway-sync-needs-reconnect',
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
      setError('Connect Safeway requires a native app (iOS/Android). Run on device or emulator.');
      setStatus(STATUS.ERROR);
      return;
    }

    setError(null);
    setResult(null);
    setProgress(null);

    try {
      setStatus(STATUS.AUTHENTICATING);
      let knownOrderIds = [];
      if (userId) {
        try {
          const { receipts } = await api.getReceipts(userId, 100);
          knownOrderIds = (receipts || [])
            .filter((r) => r?.provider === 'safeway' && r?.order_id)
            .map((r) => r.order_id);
        } catch (_) {}
      }

      const tokens = await startLogin();

      if (!tokens?.accessToken) {
        throw new Error('Safeway login did not complete. Please try again.');
      }
      if (!tokens?.clubCard) {
        throw new Error(
          'Could not read your Safeway club card. Please try signing in again.'
        );
      }

      setStatus(STATUS.FETCHING);
      let raw;
      let receipts;
      try {
        raw = await fetchSafewayReceipts({
          accessToken: tokens.accessToken,
          clubCard: tokens.clubCard,
          knownOrderIds,
          daysOverride: hasStoredTokensState ? 3 : 90,
          cookieHeader: tokens.cookieHeader,
        });
        receipts = (raw || []).map((r) => parseSafewayReceipt(r)).filter(Boolean);
      } catch (fetchErr) {
        await handleFetchAuthError(fetchErr, async () => {
          await clearStoredTokens();
          setHasStoredTokensState(false);
        });
        throw fetchErr;
      }

      const rawCount = (raw || []).length;
      const parsedCount = receipts.length;
      const mapped = mapSafewaySilentToOutcome(tokens, {
        rawCount,
        parsedCount,
        fetchCompleted: true,
      });

      if (mapped.outcome === SYNC_OUTCOMES.FAILED) {
        setProgress(null);
        const msg =
          mapped.reason === 'parse_all_dropped'
            ? SAFEWAY_MISSING_CLUB_MESSAGE
            : 'Failed to fetch receipts.';
        setError(msg);
        setStatus(STATUS.ERROR);
        dispatchProviderSyncFailed('safeway', { reason: mapped.reason, message: msg });
        return;
      }

      if (!userId) {
        setProgress(null);
        setResult({ receipts, count: receipts.length, receipts_stored: 0, items_added_to_pantry: 0 });
        await writeLastRun('safeway');
        await clearSafewayReconnectCooldown();
        dispatchProviderSyncCompleted('safeway', {
          tier: 'manual',
          receipts_stored: 0,
          items_added: 0,
          outcome: mapped.outcome,
        });
        setStatus(STATUS.SUCCESS);
        return;
      }

      if (mapped.outcome === SYNC_OUTCOMES.COMPLETED_EMPTY) {
        setProgress(null);
        setResult({
          receipts: [],
          count: 0,
          receipts_stored: 0,
          items_added_to_pantry: 0,
        });
        await writeLastRun('safeway');
        await clearSafewayReconnectCooldown();
        dispatchProviderSyncCompleted('safeway', {
          tier: 'manual',
          receipts_stored: 0,
          items_added: 0,
          outcome: SYNC_OUTCOMES.COMPLETED_EMPTY,
        });
        setStatus(STATUS.SUCCESS);
        return;
      }

      setStatus(STATUS.SUBMITTING);
      void logPhase('safeway', SyncPhase.INGEST_STARTED, { mode: 'login' });
      let finalBackend;
      try {
        finalBackend = await api.ingestReceipts('safeway', receipts, userId);
      } catch (ingestErr) {
        void reportAnomaly('safeway', SyncPhase.INGEST_FAILED, {
          mode: 'login',
          reason: ingestErr?.message || String(ingestErr),
        });
        throw ingestErr;
      }
      setProgress(null);
      const itemsAdded = finalBackend.items_added_to_pantry ?? 0;
      if (itemsAdded > 3) {
        void api.suggestions
          .triggerGeneration(userId, { triggerReason: 'receipt_scan' })
          .catch(() => {});
      }
      setResult({
        receipts,
        count: receipts.length,
        receipts_stored: finalBackend.receipts_stored ?? receipts.length,
        items_added_to_pantry: itemsAdded,
        errors: finalBackend.errors ?? [],
      });
      await writeLastRun('safeway');
      await clearSafewayReconnectCooldown();
      dispatchProviderSyncCompleted('safeway', {
        tier: 'manual',
        receipts_stored: finalBackend.receipts_stored ?? receipts.length,
        items_added: itemsAdded,
        outcome: mapped.outcome,
      });
      void logPhase('safeway', SyncPhase.SYNC_SUCCEEDED, {
        mode: 'login',
        metadata: {
          receipts_stored: finalBackend.receipts_stored ?? receipts.length,
          items_added: itemsAdded,
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
        }) === 'expired';
      console.error(`${LOG_PREFIX} startSync failed`, err?.message || err, err);
      void reportAnomaly('safeway', SyncPhase.SYNC_FAILED, {
        mode: 'login',
        reason: msg,
      });
      setProgress(null);
      if (isTokenError) {
        await clearStoredTokens();
        setHasStoredTokensState(false);
      }
      dispatchCatchSyncOutcome(err, msg);
      setError(msg);
      setStatus(STATUS.ERROR);
    }
  }, [userId, hasStoredTokensState]);

  const startSilent = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      setError('Connect Safeway requires a native app.');
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
    setProgress(null);

    try {
      setStatus(STATUS.FETCHING);
      let knownOrderIds = [];
      try {
        const { receipts } = await api.getReceipts(userId, 100);
        knownOrderIds = (receipts || [])
          .filter((r) => r?.provider === 'safeway' && r?.order_id)
          .map((r) => r.order_id);
      } catch (_) {}

      const syncResult = await startSilentSync();
      const extractKind = classifySafewaySilentResult(syncResult);

      if (extractKind === 'skipped') {
        setProgress(null);
        setStatus(STATUS.SKIPPED);
        return;
      }

      if (extractKind === 'timeout') {
        setProgress(null);
        setError(SAFEWAY_TIMEOUT_MESSAGE);
        setStatus(STATUS.ERROR);
        dispatchProviderSyncFailed('safeway', {
          reason: 'silent_timeout',
          message: SAFEWAY_TIMEOUT_MESSAGE,
        });
        return;
      }

      if (extractKind === 'needs_reconnect') {
        setProgress(null);
        await clearStoredTokens();
        setHasStoredTokensState(false);
        setError(SAFEWAY_RECONNECT_MESSAGE);
        setStatus(STATUS.ERROR);
        window.dispatchEvent(new CustomEvent('safeway-sync-needs-reconnect'));
        return;
      }

      if (extractKind === 'error') {
        setProgress(null);
        setError(SAFEWAY_MISSING_CLUB_MESSAGE);
        setStatus(STATUS.ERROR);
        dispatchProviderSyncFailed('safeway', {
          reason: 'missing_club_card',
          message: SAFEWAY_MISSING_CLUB_MESSAGE,
        });
        return;
      }

      let rawCount = 0;
      let parsedCount = 0;
      let receipts = [];

      try {
        const raw = await fetchSafewayReceipts({
          accessToken: syncResult.accessToken,
          clubCard: syncResult.clubCard,
          knownOrderIds,
          daysOverride: hasStoredTokensState ? 3 : 90,
          cookieHeader: syncResult.cookieHeader,
        });
        rawCount = (raw || []).length;
        receipts = (raw || []).map((r) => parseSafewayReceipt(r)).filter(Boolean);
        parsedCount = receipts.length;
      } catch (fetchErr) {
        const cleared = await handleFetchAuthError(fetchErr, async () => {
          await clearStoredTokens();
          setHasStoredTokensState(false);
        });
        if (cleared) {
          setProgress(null);
          setError(SAFEWAY_RECONNECT_MESSAGE);
          setStatus(STATUS.ERROR);
          window.dispatchEvent(new CustomEvent('safeway-sync-needs-reconnect'));
          return;
        }
        const fetchMsg = fetchErr?.message || String(fetchErr);
        dispatchProviderSyncFailed('safeway', { reason: fetchErr?.reason, message: fetchMsg });
        setProgress(null);
        setError(fetchMsg);
        setStatus(STATUS.ERROR);
        return;
      }

      const mapped = mapSafewaySilentToOutcome(syncResult, {
        rawCount,
        parsedCount,
        fetchCompleted: true,
      });

      if (mapped.outcome === SYNC_OUTCOMES.FAILED) {
        setProgress(null);
        const msg =
          mapped.reason === 'parse_all_dropped'
            ? SAFEWAY_MISSING_CLUB_MESSAGE
            : 'Failed to fetch receipts.';
        setError(msg);
        setStatus(STATUS.ERROR);
        dispatchProviderSyncFailed('safeway', { reason: mapped.reason, message: msg });
        return;
      }

      setProgress(null);

      if (mapped.outcome === SYNC_OUTCOMES.COMPLETED_EMPTY) {
        setResult({
          receipts: [],
          count: 0,
          receipts_stored: 0,
          items_added_to_pantry: 0,
          errors: [],
        });
        await writeLastRun('safeway');
        await clearSafewayReconnectCooldown();
        dispatchProviderSyncCompleted('safeway', {
          tier: 'silent',
          receipts_stored: 0,
          items_added: 0,
          outcome: SYNC_OUTCOMES.COMPLETED_EMPTY,
        });
        void logPhase('safeway', SyncPhase.SYNC_SUCCEEDED, {
          mode: 'silent',
          metadata: { receipts_stored: 0, items_added: 0, outcome: SYNC_OUTCOMES.COMPLETED_EMPTY },
        });
        setStatus(STATUS.SUCCESS);
        setHasStoredTokensState(true);
        return;
      }

      setStatus(STATUS.SUBMITTING);
      void logPhase('safeway', SyncPhase.INGEST_STARTED, { mode: 'silent' });
      let finalBackend;
      try {
        finalBackend = await api.ingestReceipts('safeway', receipts, userId);
      } catch (ingestErr) {
        void reportAnomaly('safeway', SyncPhase.INGEST_FAILED, {
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
      setResult({
        receipts,
        count: receipts.length,
        receipts_stored: finalBackend.receipts_stored ?? receipts.length,
        items_added_to_pantry: itemsAddedSilent,
        errors: finalBackend.errors ?? [],
      });
      await writeLastRun('safeway');
      await clearSafewayReconnectCooldown();
      dispatchProviderSyncCompleted('safeway', {
        tier: 'silent',
        receipts_stored: finalBackend.receipts_stored ?? receipts.length,
        items_added: itemsAddedSilent,
        outcome: SYNC_OUTCOMES.COMPLETED_ITEMS,
      });
      void logPhase('safeway', SyncPhase.SYNC_SUCCEEDED, {
        mode: 'silent',
        metadata: {
          receipts_stored: finalBackend.receipts_stored ?? receipts.length,
          items_added: itemsAddedSilent,
        },
      });
      setStatus(STATUS.SUCCESS);
      setHasStoredTokensState(true);
    } catch (err) {
      const msg = err?.message || String(err);
      console.error(`${LOG_PREFIX} startSilent failed`, msg);
      void reportAnomaly('safeway', SyncPhase.SYNC_FAILED, {
        mode: 'silent',
        reason: msg,
      });
      setProgress(null);
      dispatchCatchSyncOutcome(err, msg || 'Failed to fetch receipts.');
      setError(msg || 'Failed to fetch receipts.');
      setStatus(STATUS.ERROR);
    }
  }, [userId, hasStoredTokensState]);

  return {
    status,
    error,
    result,
    progress,
    startSync,
    startSilent,
    hasStoredTokens: hasStoredTokensState,
    checkStoredTokens,
    isNative: Capacitor.isNativePlatform(),
  };
}

export { STATUS };
