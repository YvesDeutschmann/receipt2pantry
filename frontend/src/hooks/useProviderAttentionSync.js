import { useEffect } from 'react';
import { classifyError } from '../components/ReconnectBanner';
import {
  setNeedsReconnect,
  clearProvider,
} from '../services/providerAttentionStore';

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
      };

      const onCompleted = () => {
        void clearProvider(provider);
      };

      const onError = (e) => {
        if (classifyError(e.detail?.message) === 'expired') {
          void setNeedsReconnect(provider);
        }
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
