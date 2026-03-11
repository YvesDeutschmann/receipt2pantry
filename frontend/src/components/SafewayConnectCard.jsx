/**
 * SafewayConnectCard - React UI component for Safeway WebView bridge sync
 * Renders Connect Safeway button, status messages, and result summary.
 * Replaces credential modal + MFA flow with native WebView login.
 */

import { useEffect } from 'react';
import { useSafewaySync, STATUS } from '../hooks/useSafewaySync';

export default function SafewayConnectCard({ userId, className = '' }) {
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
    return (
      <div className={`p-4 bg-amber-50 border border-amber-200 rounded-lg ${className}`}>
        <p className="text-amber-800 text-sm">
          Connect Safeway runs only on native iOS/Android. Build and run the app on a device or emulator.
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
          {status === STATUS.AUTHENTICATING && 'Sign in to Safeway…'}
          {status === STATUS.FETCHING && 'Fetching receipts…'}
          {status === STATUS.SUBMITTING && 'Saving to pantry…'}
          {!isBusy && (hasStoredTokens ? 'Sync Safeway Receipts' : 'Connect Safeway')}
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
          A browser will open to Safeway. Sign in with your Safeway account (including MFA if prompted). Your receipts will sync automatically once you are logged in.
        </p>
      )}

      {(status === STATUS.AUTHENTICATING || status === STATUS.FETCHING) && progress && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-200 border-t-blue-600" />
            <span className="text-blue-800 text-sm font-medium">
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
            <div className="mt-2 h-1.5 bg-blue-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{ width: `${Math.min(100, (progress.current / progress.total) * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {status === STATUS.SUCCESS && result && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-green-800 font-semibold">Synced — {result.items_added_to_pantry ?? 0} items added</p>
          <p className="text-green-700 text-sm mt-1">
            {result.count} receipt{result.count !== 1 ? 's' : ''} synced
            {result.receipts_stored != null && (
              <> · {result.receipts_stored} stored</>
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
