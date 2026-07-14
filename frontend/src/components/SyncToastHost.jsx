import { useState, useEffect, useRef } from 'react';
import { classifyError } from './ReconnectBanner';
import UndoToast from './UndoToast';
import { PROVIDER_LABELS } from '../services/providerAttentionStore';

const PROVIDERS = ['safeway', 'costco'];

/**
 * @param {'safeway' | 'costco'} provider
 * @returns {string}
 */
function storeLabel(provider) {
  return PROVIDER_LABELS[provider] ?? provider;
}

/**
 * Global sync feedback toasts for main-app routes. Mount once in AppShell.
 * Edge-triggered: does not repeat toasts for the same outcome state per provider.
 */
export default function SyncToastHost() {
  const [toast, setToast] = useState({ open: false, message: '' });
  /** @type {React.MutableRefObject<Record<string, string | undefined>>} */
  const lastOutcomeRef = useRef({});

  useEffect(() => {
    const showToast = (message) => {
      setToast({ open: true, message });
    };

    /**
     * @param {'safeway' | 'costco'} provider
     * @param {string} outcomeKey
     * @param {string} message
     */
    const toastOnTransition = (provider, outcomeKey, message) => {
      if (lastOutcomeRef.current[provider] === outcomeKey) return;
      lastOutcomeRef.current[provider] = outcomeKey;
      showToast(message);
    };

    const cleanups = PROVIDERS.map((provider) => {
      const label = storeLabel(provider);

      const onNeedsReconnect = () => {
        toastOnTransition(provider, 'needs_reconnect', `${label} needs reconnect`);
      };

      const onCompleted = (e) => {
        const itemsAdded = e.detail?.items_added ?? 0;
        lastOutcomeRef.current[provider] = 'ok';
        if (itemsAdded > 0) {
          const noun = itemsAdded === 1 ? 'item' : 'items';
          showToast(`Added ${itemsAdded} ${noun} from ${label}`);
        }
      };

      const onError = (e) => {
        const kind = classifyError(e.detail?.message);
        if (kind === 'expired') {
          toastOnTransition(provider, 'needs_reconnect', `${label} needs reconnect`);
          return;
        }
        toastOnTransition(provider, 'error', `Couldn't refresh ${label} — try again later`);
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

  return (
    <UndoToast
      open={toast.open}
      message={toast.message}
      onDismiss={() => setToast((prev) => ({ ...prev, open: false }))}
    />
  );
}
