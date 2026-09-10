import { useEffect } from 'react';
import { classifySyncFailure } from '../services/syncOutcomeClassifier';
import {
  setNeedsReconnect,
  setFetchFailed,
  clearProvider,
} from '../services/providerAttentionStore';
import { recordTerminalOutcome } from '../services/syncHealthStore';

const PROVIDERS = ['safeway', 'costco'];

/**
 * Listens for provider sync outcome events and persists reconnect attention items.
 * Mount once in AppRoutes (alongside useAppSyncScheduler). No toast UI here.
 */
export function useProviderAttentionSync() {
  useEffect(() => {
    const cleanups = PROVIDERS.map((provider) => {
      const onNeedsReconnect = () => {
        void setNeedsReconnect(provider);
        void recordTerminalOutcome(provider, { outcome: 'needs_reconnect' });
      };

      const onCompleted = (e) => {
        const outcome = e.detail?.outcome;
        if (outcome === 'completed_empty' || outcome === 'completed_items') {
          void clearProvider(provider);
          void recordTerminalOutcome(provider, {
            outcome,
            receiptsStored: e.detail?.receipts_stored ?? 0,
          });
        }
      };

      const onError = (e) => {
        const outcome = e.detail?.outcome;
        if (outcome === 'failed') {
          void setFetchFailed(provider);
          void recordTerminalOutcome(provider, { outcome: 'failed' });
          return;
        }
        if (outcome === 'needs_reconnect') {
          void setNeedsReconnect(provider);
          void recordTerminalOutcome(provider, { outcome: 'needs_reconnect' });
          return;
        }
        if (
          classifySyncFailure({
            reason: e.detail?.reason,
            message: e.detail?.message,
          }) === 'expired'
        ) {
          void setNeedsReconnect(provider);
          void recordTerminalOutcome(provider, { outcome: 'needs_reconnect' });
          return;
        }
        void setFetchFailed(provider);
        void recordTerminalOutcome(provider, { outcome: 'failed' });
      };

      window.addEventListener(`${provider}-sync-needs-reconnect`, onNeedsReconnect);
      window.addEventListener(`${provider}-sync-completed`, onCompleted);
      window.addEventListener(`${provider}-sync-error`, onError);

      return () => {
        window.removeEventListener(`${provider}-sync-needs-reconnect`, onNeedsReconnect);
        window.removeEventListener(`${provider}-sync-completed`, onCompleted);
        window.removeEventListener(`${provider}-sync-error`, onError);
      };
    });

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, []);
}
