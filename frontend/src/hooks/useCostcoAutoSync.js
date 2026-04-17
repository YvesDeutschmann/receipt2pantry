/**
 * useCostcoAutoSync - App lifecycle hook for automatic Costco receipt sync.
 * Triggers fetch when app comes to foreground, throttled to once per 30 minutes.
 * Uses One-Tap Sync bridge (startSilentSync + submitToBackend) when local tokens exist.
 * Only runs on native platform.
 */

import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { hasStoredTokens, startSilentSync, clearStoredTokens } from '../services/costcoWebViewBridge';
import { submitToBackend } from '../services/costcoNativeSync';
import { api } from '../services/apiClient';
import { useAuth } from '../contexts/AuthContext';

const THROTTLE_MS = 30 * 60 * 1000; // 30 minutes
const PREF_KEY_LAST_SYNC = 'costco_autosync_last_sync';

export function useCostcoAutoSync() {
  const { user } = useAuth();
  const userId = user?.id;
  const isSyncingRef = useRef(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !userId) return;

    const runSyncIfAllowed = async () => {
      if (isSyncingRef.current) return;
      try {
        const hasTokens = await hasStoredTokens();
        if (!hasTokens) return;

        const { value: lastStr } = await Preferences.get({ key: PREF_KEY_LAST_SYNC });
        const lastSync = lastStr ? parseInt(lastStr, 10) : 0;
        if (Date.now() - lastSync < THROTTLE_MS) return;

        isSyncingRef.current = true;
        const result = await startSilentSync();
        if (result?.receipts?.length > 0) {
          const storeRes = await submitToBackend(result.receipts, userId);
          if ((storeRes?.items_added_to_pantry ?? 0) > 3) {
            void api.suggestions
              .triggerGeneration(userId, { triggerReason: 'receipt_scan' })
              .catch(() => {});
          }
          if (result.idToken || result.accessToken) {
            try {
              await api.connectCostcoFromApp(userId, result);
            } catch (connectErr) {
              console.warn('[CostcoAutoSync] connect-from-app failed:', connectErr?.message || connectErr);
            }
          }
          await Preferences.set({ key: PREF_KEY_LAST_SYNC, value: String(Date.now()) });
        } else if (!result) {
          await clearStoredTokens();
          console.warn('[CostcoAutoSync] Session expired, tokens cleared');
        }
      } catch (err) {
        if (err?.response?.data?.expired_credentials) {
          console.warn('[CostcoAutoSync] Credentials expired, skipping');
        } else {
          console.warn('[CostcoAutoSync] Sync failed:', err?.message || err);
        }
      } finally {
        isSyncingRef.current = false;
      }
    };

    const listenerPromise = App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        runSyncIfAllowed();
      }
    });

    return () => {
      listenerPromise.then((handle) => handle?.remove?.()).catch(() => {});
    };
  }, [userId]);
}
