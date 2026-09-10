/**
 * SafewayConnectCard - React UI component for Safeway WebView bridge sync
 * Renders Connect Safeway button, status messages, and result summary.
 * Replaces credential modal + MFA flow with native WebView login.
 */

import { useEffect, useState, useCallback } from 'react';
import { useSafewaySync, STATUS } from '../hooks/useSafewaySync';
import { api } from '../services/apiClient';
import SyncSuccessAlert from './SyncSuccessAlert';
import ReconnectBanner from './ReconnectBanner';
import SyncHealthRow from './SyncHealthRow';

function DevMockSafewayBlock({ userId, className = '' }) {
  const [mockStatus, setMockStatus] = useState('idle');
  const [mockError, setMockError] = useState(null);
  const [mockResult, setMockResult] = useState(null);

  const isBusy = mockStatus === 'submitting';

  const runMockSync = useCallback(async () => {
    if (!userId) {
      setMockError('Sign in to load mock receipts.');
      setMockResult(null);
      return;
    }
    setMockError(null);
    setMockResult(null);
    setMockStatus('submitting');
    try {
      const { safewayFixtures } = await import('../devFixtures');
      const finalBackend = await api.ingestReceipts('safeway', safewayFixtures, userId);
      const itemsAdded = finalBackend.items_added_to_pantry ?? 0;
      if (itemsAdded > 3) {
        void api.suggestions
          .triggerGeneration(userId, { triggerReason: 'receipt_scan' })
          .catch(() => {});
      }
      setMockResult({
        count: safewayFixtures.length,
        receipts_stored: finalBackend.receipts_stored,
        items_added_to_pantry: itemsAdded,
        errors: finalBackend.errors ?? [],
      });
      setMockStatus('success');
    } catch (err) {
      setMockError(err?.message || String(err));
      setMockStatus('error');
    }
  }, [userId]);

  return (
    <div
      className={`p-3 border border-dashed border-terra/40 rounded-meald-md bg-terra/5 space-y-2 ${className}`}
    >
      <p className="text-xs text-terra font-medium">Dev: mock sync (no Safeway / WebView)</p>
      <button
        type="button"
        onClick={runMockSync}
        disabled={isBusy}
        className="btn btn-primary text-sm py-1.5 px-3 disabled:opacity-50"
      >
        {isBusy ? 'Saving to pantry…' : 'Mock sync (DEV)'}
      </button>
      {mockStatus === 'success' && mockResult && (
        <SyncSuccessAlert
          isMock
          className="text-sm"
          count={mockResult.count}
          itemsAddedToPantry={mockResult.items_added_to_pantry}
          errors={mockResult.errors}
        />
      )}
      {mockStatus === 'error' && mockError && (
        <p className="text-sm text-[var(--color-error)]">{mockError}</p>
      )}
    </div>
  );
}

export default function SafewayConnectCard({ userId, className = '' }) {
  const isDev = import.meta.env.DEV;
  const {
    status,
    error,
    result,
    progress,
    startSync,
    startSilent,
    hasStoredTokens,
    checkStoredTokens,
    isNative,
  } = useSafewaySync(userId);

  useEffect(() => {
    checkStoredTokens();
  }, [checkStoredTokens]);

  const isBusy =
    status === STATUS.AUTHENTICATING ||
    status === STATUS.FETCHING ||
    status === STATUS.SUBMITTING;

  if (!isNative) {
    if (!isDev) {
      return (
        <div className={`alert alert-warning ${className}`}>
          <p className="text-sm">
            Connect Safeway runs only on native iOS/Android. Build and run the app on a device or
            emulator.
          </p>
        </div>
      );
    }
    return (
      <div className={`space-y-4 ${className}`}>
        <div className="alert alert-warning">
          <p className="text-sm">
            Connect Safeway runs only on native iOS/Android. In dev you can still load mock receipts
            below.
          </p>
        </div>
        <DevMockSafewayBlock userId={userId} />
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <ReconnectBanner provider="safeway" storeName="Safeway" onReconnect={startSync} />
      <div className="flex flex-wrap gap-3 items-center">
        <button
          type="button"
          onClick={startSync}
          disabled={isBusy}
          className="btn btn-primary px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === STATUS.AUTHENTICATING && 'Sign in to Safeway…'}
          {status === STATUS.FETCHING && 'Fetching receipts…'}
          {status === STATUS.SUBMITTING && 'Saving to pantry…'}
          {!isBusy && (hasStoredTokens ? 'Sync Safeway Receipts' : 'Connect Safeway')}
        </button>
        {hasStoredTokens && (
          <button
            type="button"
            onClick={startSilent}
            disabled={isBusy}
            className="btn btn-ghost px-4 py-2 disabled:opacity-50"
          >
            Silent Sync
          </button>
        )}
      </div>

      <SyncHealthRow
        provider="safeway"
        syncInProgress={status === STATUS.SKIPPED}
      />

      {status === STATUS.AUTHENTICATING && (
        <p className="text-sage-light text-sm">
          A browser will open to Safeway. Sign in with your Safeway account (including MFA if
          prompted). Your receipts will sync automatically once you are logged in.
        </p>
      )}

      {(status === STATUS.AUTHENTICATING || status === STATUS.FETCHING) && progress && (
        <div className="alert alert-info space-y-3">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-forest-mid border-t-terra" />
            <span className="text-sm font-medium">
              {progress?.total > 0 && progress.current > 0
                ? `Loading receipt ${progress.current} of ${progress.total}…`
                : progress?.step === 'token_found'
                  ? 'Connecting to Safeway…'
                  : progress?.step === 'list_fetched'
                    ? `Found ${progress.total} receipts, loading details…`
                    : 'Fetching receipts…'}
            </span>
          </div>
          {progress?.total > 0 && (
            <div className="mt-2 h-1.5 bg-forest rounded-full overflow-hidden">
              <div
                className="h-full bg-terra transition-all duration-300"
                style={{ width: `${Math.min(100, (progress.current / progress.total) * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {status === STATUS.SUCCESS && result && (
        <SyncSuccessAlert
          count={result.count}
          itemsAddedToPantry={result.items_added_to_pantry}
          errors={result.errors}
        />
      )}

      {status === STATUS.ERROR && error && (
        <div className="alert alert-error flex flex-col gap-2">
          <p>{error}</p>
          <button
            type="button"
            onClick={startSync}
            className="self-start btn btn-ghost text-sm py-1.5 px-3"
          >
            Retry
          </button>
        </div>
      )}

      {isDev && <DevMockSafewayBlock userId={userId} />}
    </div>
  );
}
