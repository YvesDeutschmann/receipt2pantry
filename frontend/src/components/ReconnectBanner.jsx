import { useState, useEffect, useRef, useCallback } from 'react';
import { classifyError, classifySyncFailure } from '../services/syncOutcomeClassifier';

export { classifyError };

/**
 * @param {{
 *   provider: 'safeway' | 'costco',
 *   onReconnect: () => void,
 *   storeName: string,
 *   testForceVisible?: boolean,
 * }} props
 */
export default function ReconnectBanner({ provider, onReconnect, storeName, testForceVisible }) {
  const [visible, setVisible] = useState(testForceVisible ?? false);
  const [dismissed, setDismissed] = useState(false);
  const activelyShowingRef = useRef(testForceVisible ?? false);

  useEffect(() => {
    activelyShowingRef.current = visible && !dismissed;
  }, [visible, dismissed]);

  const show = useCallback(() => {
    if (activelyShowingRef.current) return;
    setDismissed(false);
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    setVisible(false);
  }, []);

  useEffect(() => {
    const onSyncError = (e) => {
      if (e.detail?.outcome === 'failed') return;
      if (e.detail?.outcome === 'needs_reconnect') {
        show();
        return;
      }
      if (
        classifySyncFailure({
          reason: e.detail?.reason,
          message: e.detail?.message,
        }) === 'expired'
      ) {
        show();
      }
    };

    window.addEventListener(`${provider}-sync-needs-reconnect`, show);
    window.addEventListener(`${provider}-sync-completed`, hide);
    window.addEventListener(`${provider}-sync-error`, onSyncError);

    return () => {
      window.removeEventListener(`${provider}-sync-needs-reconnect`, show);
      window.removeEventListener(`${provider}-sync-completed`, hide);
      window.removeEventListener(`${provider}-sync-error`, onSyncError);
    };
  }, [provider, show, hide]);

  if (!visible || dismissed) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="alert alert-warning flex items-start justify-between gap-3"
    >
      <p className="text-sm font-medium">
        Tap <strong>Reconnect {storeName}</strong> to sign in again and keep your pantry up to date.
      </p>
      <div className="flex gap-2 shrink-0">
        <button type="button" onClick={onReconnect} className="btn btn-primary text-sm py-1 px-3">
          Reconnect {storeName}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="btn btn-ghost text-sm p-1"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
