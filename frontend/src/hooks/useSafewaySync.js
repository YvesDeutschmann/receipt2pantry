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
} from '../services/safewayWebViewBridge';
import { parseSafewayReceipt } from '../services/safewayReceiptParser';
import { api } from '../services/apiClient';

const LOG_PREFIX = '[SafewaySync]';
const STATUS = {
  IDLE: 'idle',
  AUTHENTICATING: 'authenticating',
  FETCHING: 'fetching',
  SUBMITTING: 'submitting',
  SUCCESS: 'success',
  ERROR: 'error',
};

async function handleFetchAuthError(err, clearTokens) {
  const status = err?.status;
  const msg = err?.message || String(err);
  const isAuth =
    status === 401 ||
    status === 403 ||
    /401|403|unauthorized|forbidden/i.test(msg);
  if (isAuth) {
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
      let receipts;
      try {
        const raw = await fetchSafewayReceipts({
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

      if (!userId) {
        setProgress(null);
        setResult({ receipts, count: receipts.length, receipts_stored: 0, items_added_to_pantry: 0 });
        setStatus(STATUS.SUCCESS);
        return;
      }

      setStatus(STATUS.SUBMITTING);
      const finalBackend = await api.ingestReceipts('safeway', receipts, userId);
      setProgress(null);
      setResult({
        receipts,
        count: receipts.length,
        receipts_stored: finalBackend.receipts_stored ?? receipts.length,
        items_added_to_pantry: finalBackend.items_added_to_pantry ?? 0,
        errors: finalBackend.errors ?? [],
      });
      setStatus(STATUS.SUCCESS);
      setHasStoredTokensState(true);
    } catch (err) {
      const msg = err?.message || String(err);
      const isTokenError = /token.*invalid|token.*expired|401|403|session.*expired/i.test(msg);
      console.error(`${LOG_PREFIX} startSync failed`, err?.message || err, err);
      setProgress(null);
      if (isTokenError) {
        await clearStoredTokens();
        setHasStoredTokensState(false);
      }
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
      if (!syncResult) {
        setProgress(null);
        await clearStoredTokens();
        setHasStoredTokensState(false);
        setError('Safeway session expired. Please sign in again.');
        setStatus(STATUS.ERROR);
        return;
      }

      if (!syncResult.accessToken) {
        throw new Error('Safeway session invalid. Please sign in again.');
      }
      if (!syncResult.clubCard) {
        await clearStoredTokens();
        setHasStoredTokensState(false);
        setError('Could not read your Safeway club card. Please sign in again.');
        setStatus(STATUS.ERROR);
        return;
      }

      let receipts = [];
      try {
        const raw = await fetchSafewayReceipts({
          accessToken: syncResult.accessToken,
          clubCard: syncResult.clubCard,
          knownOrderIds,
          daysOverride: hasStoredTokensState ? 3 : 90,
          cookieHeader: syncResult.cookieHeader,
        });
        receipts = (raw || []).map((r) => parseSafewayReceipt(r)).filter(Boolean);
      } catch (fetchErr) {
        await handleFetchAuthError(fetchErr, async () => {
          await clearStoredTokens();
          setHasStoredTokensState(false);
        });
        throw fetchErr;
      }

      setProgress(null);
      if (receipts.length > 0) {
        setStatus(STATUS.SUBMITTING);
        const finalBackend = await api.ingestReceipts('safeway', receipts, userId);
        setResult({
          receipts,
          count: receipts.length,
          receipts_stored: finalBackend.receipts_stored ?? receipts.length,
          items_added_to_pantry: finalBackend.items_added_to_pantry ?? 0,
          errors: finalBackend.errors ?? [],
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
      console.error(`${LOG_PREFIX} startSilent failed`, msg);
      setProgress(null);
      await clearStoredTokens();
      setHasStoredTokensState(false);
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
