/**
 * CostcoOneTapSync - React UI component for One-Tap Costco receipt sync
 * Renders sync button, status messages, and result summary.
 */

import { useEffect } from 'react';
import { useCostcoSync, STATUS } from './useCostcoSync';

export default function CostcoOneTapSync({ userId, days = 90, apiBaseUrl, className = '' }) {
  const {
    status,
    error,
    result,
    startSync,
    startSilent,
    hasStoredTokens,
    checkStoredTokens,
    isNative,
  } = useCostcoSync(userId, { days, apiBaseUrl });

  useEffect(() => {
    checkStoredTokens();
  }, [checkStoredTokens]);

  const isBusy =
    status === STATUS.AUTHENTICATING ||
    status === STATUS.FETCHING ||
    status === STATUS.SUBMITTING;

  if (!isNative) {
    return (
      <div className={`p-4 bg-amber-50 border border-amber-200 rounded-lg ${className}`}>
        <p className="text-amber-800 text-sm">
          One-Tap Sync runs only on native iOS/Android. Build and run the app on a device or emulator.
        </p>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex flex-wrap gap-3 items-center">
        <button
          onClick={startSync}
          disabled={isBusy}
          className="px-4 py-2 rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === STATUS.AUTHENTICATING && 'Sign in to Costco…'}
          {status === STATUS.FETCHING && 'Fetching receipts…'}
          {status === STATUS.SUBMITTING && 'Saving to pantry…'}
          {!isBusy && 'Sync Costco Receipts'}
        </button>
        {hasStoredTokens && (
          <button
            onClick={startSilent}
            disabled={isBusy}
            className="px-4 py-2 rounded-lg font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
          >
            Silent Sync
          </button>
        )}
      </div>

      {status === STATUS.AUTHENTICATING && (
        <p className="text-gray-600 text-sm">
          A browser will open to Costco. Sign in, then go to <strong>Order &amp; Purchases</strong> and tap the <strong>Warehouse</strong> tab. Your receipts will sync once the page loads.
        </p>
      )}

      {status === STATUS.SUCCESS && result && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-green-800 font-semibold">Sync complete</p>
          <p className="text-green-700 text-sm mt-1">
            {result.count} receipt{result.count !== 1 ? 's' : ''} synced
            {result.items_added_to_pantry != null && result.items_added_to_pantry > 0 && (
              <> · {result.items_added_to_pantry} item{result.items_added_to_pantry !== 1 ? 's' : ''} added to pantry</>
            )}
          </p>
          {result.errors?.length > 0 && (
            <p className="text-amber-700 text-sm mt-1">
              Some issues: {result.errors.join('; ')}
            </p>
          )}
        </div>
      )}

      {status === STATUS.ERROR && error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex flex-col gap-2">
          <p className="text-red-800">{error}</p>
          <button
            onClick={startSync}
            className="self-start px-3 py-1.5 text-sm rounded bg-red-100 text-red-700 hover:bg-red-200"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
