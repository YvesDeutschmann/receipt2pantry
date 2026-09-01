/**
 * CostcoOneTapSync - React UI component for One-Tap Costco receipt sync
 * Renders sync button, status messages, and result summary.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useCostcoSync, STATUS } from '../hooks/useCostcoSync';
import { api } from '../services/apiClient';
import SyncSuccessAlert from './SyncSuccessAlert';
import ReconnectBanner from './ReconnectBanner';
import { COSTCO_RECONNECT_MESSAGE } from '../services/costcoSilentSyncOutcome';

function DevMockCostcoBlock({ userId, onSyncSuccess, className = '' }) {
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
      const { costcoFixtures } = await import('../devFixtures');
      const finalBackend = await api.storeCostcoReceipts(costcoFixtures, userId);
      const itemsAdded = finalBackend.items_added_to_pantry ?? 0;
      if (itemsAdded > 3) {
        void api.suggestions
          .triggerGeneration(userId, { triggerReason: 'receipt_scan' })
          .catch(() => {});
      }
      const payload = {
        receipts: costcoFixtures,
        count: costcoFixtures.length,
        receipts_stored: finalBackend.receipts_stored,
        items_added_to_pantry: itemsAdded,
        errors: finalBackend.errors ?? [],
      };
      setMockResult(payload);
      setMockStatus('success');
      onSyncSuccess?.(payload);
    } catch (err) {
      setMockError(err?.message || String(err));
      setMockStatus('error');
    }
  }, [userId, onSyncSuccess]);

  return (
    <div
      className={`p-3 border border-dashed border-terra/40 rounded-mise-md bg-terra/5 space-y-2 ${className}`}
    >
      <p className="text-xs text-terra font-medium">Dev: mock sync (no Costco / WebView)</p>
      <button
        type="button"
        onClick={runMockSync}
        disabled={isBusy}
        className="btn btn-secondary px-3 py-1.5 text-sm disabled:opacity-50"
      >
        {isBusy ? 'Saving to pantry…' : 'Mock sync (DEV)'}
      </button>
      {mockStatus === 'success' && mockResult && (
        <SyncSuccessAlert
          isMock
          count={mockResult.count}
          itemsAddedToPantry={mockResult.items_added_to_pantry}
          errors={mockResult.errors}
        />
      )}
      {mockStatus === 'error' && mockError && <p className="text-sm text-[var(--color-error)]">{mockError}</p>}
    </div>
  );
}

export default function CostcoOneTapSync({ userId, className = '', onSyncSuccess }) {
  const isDev = import.meta.env.DEV;
  const {
    status,
    error,
    result,
    startSync,
    startSilent,
    hasStoredTokens,
    checkStoredTokens,
    isNative,
  } = useCostcoSync(userId);

  const needsInteractiveRetry = error === COSTCO_RECONNECT_MESSAGE;

  const successFiredRef = useRef(false);

  useEffect(() => {
    checkStoredTokens();
  }, [checkStoredTokens]);

  useEffect(() => {
    if (status === STATUS.SUCCESS && result && onSyncSuccess) {
      if (successFiredRef.current) return;
      successFiredRef.current = true;
      onSyncSuccess(result);
    }
    if (status !== STATUS.SUCCESS) {
      successFiredRef.current = false;
    }
  }, [status, result, onSyncSuccess]);

  const isBusy =
    status === STATUS.AUTHENTICATING ||
    status === STATUS.FETCHING ||
    status === STATUS.SUBMITTING;

  if (!isNative) {
    if (!isDev) {
      return (
        <div className={`alert alert-warning ${className}`}>
          <p className="text-sm">
            One-Tap Sync runs only on native iOS/Android. Build and run the app on a device or
            emulator.
          </p>
        </div>
      );
    }
    return (
      <div className={`space-y-4 ${className}`}>
        <div className="alert alert-warning">
          <p className="text-sm">
            One-Tap Sync runs only on native iOS/Android. In dev you can still load mock receipts
            below.
          </p>
        </div>
        <DevMockCostcoBlock userId={userId} onSyncSuccess={onSyncSuccess} />
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <ReconnectBanner provider="costco" storeName="Costco" onReconnect={startSync} />
      <div className="flex flex-wrap gap-3 items-center">
        <button
          type="button"
          onClick={startSync}
          disabled={isBusy}
          className="btn btn-primary px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === STATUS.AUTHENTICATING && 'Sign in to Costco…'}
          {status === STATUS.FETCHING && 'Fetching receipts…'}
          {status === STATUS.SUBMITTING && 'Saving to pantry…'}
          {!isBusy && 'Sync Costco Receipts'}
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

      {status === STATUS.AUTHENTICATING && (
        <p className="text-sage-light text-sm">
          A browser will open to Costco. Sign in, then go to <strong>Order &amp; Purchases</strong>{' '}
          and tap the <strong>Warehouse</strong> tab. Your receipts will sync once the page loads.
        </p>
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
            onClick={() => (needsInteractiveRetry ? startSync() : hasStoredTokens ? startSilent() : startSync())}
            className="self-start btn btn-ghost text-sm py-1.5 px-3"
          >
            Retry
          </button>
        </div>
      )}

      {isDev && <DevMockCostcoBlock userId={userId} onSyncSuccess={onSyncSuccess} />}
    </div>
  );
}
