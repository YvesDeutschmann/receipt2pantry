/**
 * useSafewaySync - React hook for Safeway WebView bridge sync flow
 * Orchestrates: login (WebView) -> in-WebView receipt fetch -> POST to /api/receipts/ingest
 */

import { useState, useCallback, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { hasStoredTokens, startLogin, startSilentSync, clearStoredTokens, setPreExtractContext } from '../services/safewayWebViewBridge';
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
      setPreExtractContext({
        knownOrderIds,
        daysOverride: hasStoredTokensState ? 3 : 7,
      });

      const tokens = await startLogin();
      console.log(`${LOG_PREFIX} startSync: login complete`);

      setStatus(STATUS.FETCHING);
      let receipts;

      if (tokens?.receipts != null && tokens?._fromWebView) {
        receipts = tokens.receipts;
        console.log(`${LOG_PREFIX} Using ${receipts?.length ?? 0} receipts from in-WebView fetch`);
      } else if (tokens?._closeWebViewAfterFetch) {
        throw new Error('Could not fetch receipts. Please try again and complete your Safeway login.');
      } else {
        throw new Error('In-WebView fetch did not return receipts. Please try again after signing in.');
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
      setPreExtractContext({
        knownOrderIds,
        daysOverride: hasStoredTokensState ? 3 : 7,
      });

      const syncResult = await startSilentSync();
      if (!syncResult) {
        setProgress(null);
        await clearStoredTokens();
        setHasStoredTokensState(false);
        setError('Safeway session expired. Please sign in again.');
        setStatus(STATUS.ERROR);
        return;
      }

      const receipts = syncResult.receipts ?? [];
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
