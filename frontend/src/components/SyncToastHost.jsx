import { useState, useEffect, useRef } from 'react';
import { classifySyncFailure } from '../services/syncOutcomeClassifier';
import UndoToast from './UndoToast';
import { PROVIDER_LABELS } from '../services/providerAttentionStore';
import { getAllHealth, setLastToastedOutcome } from '../services/syncHealthStore';

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
  const sessionToastedRef = useRef({});

  useEffect(() => {
    const showToast = (message) => {
      setToast({ open: true, message });
    };

    /**
     * @param {'safeway' | 'costco'} provider
     * @param {string} outcomeKey
     * @param {string} message
     */
    const toastOnTransition = async (provider, outcomeKey, message) => {
      if (sessionToastedRef.current[provider] === outcomeKey) return;

      const all = await getAllHealth();
      if (all[provider]?.lastToastedOutcome === outcomeKey) {
        sessionToastedRef.current[provider] = outcomeKey;
        return;
      }

      sessionToastedRef.current[provider] = outcomeKey;
      showToast(message);
      void setLastToastedOutcome(provider, outcomeKey);
    };

    const cleanups = PROVIDERS.map((provider) => {
      const label = storeLabel(provider);

      const onNeedsReconnect = () => {
        void toastOnTransition(provider, 'needs_reconnect', `${label} needs reconnect`);
      };

      const onCompleted = (e) => {
        const itemsAdded = e.detail?.items_added ?? 0;
        sessionToastedRef.current[provider] = 'ok';
        void setLastToastedOutcome(provider, 'ok');
        if (itemsAdded > 0) {
          const noun = itemsAdded === 1 ? 'item' : 'items';
          showToast(`Added ${itemsAdded} ${noun} from ${label}`);
        }
      };

      const onError = (e) => {
        const outcome = e.detail?.outcome;
        if (outcome === 'failed') {
          void toastOnTransition(
            provider,
            'error',
            `Couldn't refresh ${label} — try again later`
          );
          return;
        }
        if (outcome === 'needs_reconnect') {
          void toastOnTransition(provider, 'needs_reconnect', `${label} needs reconnect`);
          return;
        }
        const kind = classifySyncFailure({
          reason: e.detail?.reason,
          message: e.detail?.message,
        });
        if (kind === 'expired') {
          void toastOnTransition(provider, 'needs_reconnect', `${label} needs reconnect`);
          return;
        }
        void toastOnTransition(provider, 'error', `Couldn't refresh ${label} — try again later`);
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
