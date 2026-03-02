/**
 * useCostcoAutoSync - App lifecycle hook for automatic Costco receipt sync.
 * Triggers fetch when app comes to foreground, throttled to once per 30 minutes.
 * Only runs on native platform when Costco is connected.
 */

import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
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
        const { value: lastStr } = await Preferences.get({ key: PREF_KEY_LAST_SYNC });
        const lastSync = lastStr ? parseInt(lastStr, 10) : 0;
        if (Date.now() - lastSync < THROTTLE_MS) return;

        const status = await api.getProviderStatus('costco', userId);
        if (!status?.configured || !status?.active) return;

        isSyncingRef.current = true;
        await api.fetchReceiptsWithStoredCredentials('costco', userId, 90);
        await Preferences.set({ key: PREF_KEY_LAST_SYNC, value: String(Date.now()) });
      } catch (err) {
        if (err?.response?.data?.expired_credentials) {
          console.warn('[CostcoAutoSync] Credentials expired, skipping');
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
