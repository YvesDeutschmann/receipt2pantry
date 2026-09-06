import { useEffect, useRef } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { readFlags, redact } from '../services/syncDebugFlags';
import * as safewayBridge from '../services/safewayWebViewBridge';
import * as costcoBridge from '../services/costcoWebViewBridge';
import { fetchSafewayReceipts } from '../services/safewayWebViewBridge';
import { parseSafewayReceipt } from '../services/safewayReceiptParser';
import { submitSilentReceipts } from '../services/costcoSilentIngest';
import { api } from '../services/apiClient';
import { logPhase, reportAnomaly, SyncPhase } from '../services/syncEventLog';
import {
  classifyCostcoSilentResult,
  isTerminalSilentReconnectResult,
} from '../services/costcoSilentSyncOutcome';
import { classifySafewaySilentResult } from '../services/safewaySilentSyncOutcome';
import {
  isCostcoReconnectCooldownActive,
  setCostcoReconnectCooldown,
  clearCostcoReconnectCooldown,
} from '../services/costcoWebViewBridge';
import {
  isSafewayReconnectCooldownActive,
  setSafewayReconnectCooldown,
  clearSafewayReconnectCooldown,
} from '../services/safewayWebViewBridge';

// [CHANGED from Phase 4] Default is always-on; SYNC_AUTO_ENABLED='0' is the kill-switch.
const AUTO_SYNC_KILL_SWITCH = '0';
const DEFAULT_MIN_RESYNC_MS = 4 * 60 * 60 * 1000; // 4 hours
const DEBOUNCE_MS = 1000;
const MOUNT_DELAY_MS = 250; // let auth context settle

const hasSafewayTokens = safewayBridge.hasStoredTokens;
const hasCostcoTokens = costcoBridge.hasStoredTokens;

// TODO: replace with runSafewaySilentSync once silent_sync Phase 3 is merged
async function adaptSafewaySilentSync(userId) {
  if (await isSafewayReconnectCooldownActive()) {
    return { outcome: 'skipped', reason: 'reconnect_cooldown' };
  }

  const syncResult = await safewayBridge.startSilentSync();
  const kind = classifySafewaySilentResult(syncResult);

  if (kind === 'skipped') {
    return { outcome: 'skipped' };
  }
  if (kind === 'timeout') {
    return { outcome: 'error', message: 'silent_timeout' };
  }
  if (kind === 'needs_reconnect') {
    await setSafewayReconnectCooldown();
    return { outcome: 'needs_reconnect', message: syncResult?.reason || 'needs_reconnect' };
  }
  if (kind === 'error') {
    return { outcome: 'error', message: 'missing_club_card' };
  }

  try {
    let knownOrderIds = [];
    try {
      const { receipts } = await api.getReceipts(userId, 100);
      knownOrderIds = (receipts || [])
        .filter((r) => r?.provider === 'safeway' && r?.order_id)
        .map((r) => r.order_id);
    } catch (_) {
      /* non-fatal */
    }

    const raw = await fetchSafewayReceipts({
      accessToken: syncResult.accessToken,
      clubCard: syncResult.clubCard,
      knownOrderIds,
      daysOverride: 3,
      cookieHeader: syncResult.cookieHeader,
    });
    const receipts = (raw || []).map((r) => parseSafewayReceipt(r)).filter(Boolean);

    if (receipts.length === 0) {
      await clearSafewayReconnectCooldown();
      return { outcome: 'synced', tier: 'silent', receipts_stored: 0, items_added: 0 };
    }

    const finalBackend = await api.ingestReceipts('safeway', receipts, userId);
    const itemsAdded = finalBackend.items_added_to_pantry ?? 0;
    if (itemsAdded > 3) {
      void api.suggestions
        .triggerGeneration(userId, { triggerReason: 'receipt_scan' })
        .catch(() => {});
    }
    await clearSafewayReconnectCooldown();
    return {
      outcome: 'synced',
      tier: 'silent',
      receipts_stored: finalBackend.receipts_stored ?? receipts.length,
      items_added: itemsAdded,
    };
  } catch (err) {
    const status = err?.status;
    const msg = err?.message || String(err);
    const isAuth =
      status === 401 ||
      status === 403 ||
      /401|403|unauthorized|forbidden/i.test(msg);
    if (isAuth) {
      await setSafewayReconnectCooldown();
      return { outcome: 'needs_reconnect' };
    }
    return { outcome: 'error', message: msg };
  }
}

// TODO: replace with runCostcoSilentSync once silent_sync Phase 3 is merged
async function adaptCostcoSilentSync(userId) {
  if (await isCostcoReconnectCooldownActive()) {
    return { outcome: 'skipped', reason: 'reconnect_cooldown' };
  }

  const result = await costcoBridge.startSilentSync();
  const kind = classifyCostcoSilentResult(result);

  if (kind === 'skipped') {
    return { outcome: 'skipped' };
  }
  if (kind === 'timeout') {
    return { outcome: 'error', message: 'silent_timeout' };
  }
  if (kind === 'needs_reconnect') {
    if (isTerminalSilentReconnectResult(result)) {
      await setCostcoReconnectCooldown();
    }
    return { outcome: 'needs_reconnect', message: result?.reason || 'needs_reconnect' };
  }
  if (kind === 'tokens_only') {
    return { outcome: 'error', message: 'tokens_only' };
  }

  try {
    const receipts = result.receipts ?? [];
    if (receipts.length > 0) {
      const finalBackend = await submitSilentReceipts(receipts, userId, {
        getCurrentUserId: () => userId,
      });
      const itemsAdded = finalBackend.items_added_to_pantry ?? 0;
      if (itemsAdded > 3) {
        void api.suggestions
          .triggerGeneration(userId, { triggerReason: 'receipt_scan' })
          .catch(() => {});
      }
      if (result.idToken || result.accessToken) {
        try {
          await api.connectCostcoFromApp(userId, result);
          await clearCostcoReconnectCooldown();
        } catch (connectErr) {
          console.warn(
            '[AppSyncScheduler] costco connect-from-app failed:',
            redact(connectErr?.message || connectErr)
          );
        }
      }
      return {
        outcome: 'synced',
        tier: 'silent',
        receipts_stored: finalBackend.receipts_stored ?? receipts.length,
        items_added: itemsAdded,
      };
    }

    return { outcome: 'synced', tier: 'silent', receipts_stored: 0, items_added: 0 };
  } catch (err) {
    const msg = err?.message || String(err);
    const isTokenError = /token.*invalid|token.*expired|65535|in-webview fetch/i.test(msg);
    if (isTokenError) {
      await setCostcoReconnectCooldown();
      return { outcome: 'needs_reconnect' };
    }
    return { outcome: 'error', message: msg };
  }
}

const runSafewaySilentSync =
  typeof safewayBridge.runSafewaySilentSync === 'function'
    ? safewayBridge.runSafewaySilentSync
    : adaptSafewaySilentSync;

const runCostcoSilentSync =
  typeof costcoBridge.runCostcoSilentSync === 'function'
    ? costcoBridge.runCostcoSilentSync
    : adaptCostcoSilentSync;

// [CHANGED from Phase 4] Auto-sync is on unless SYNC_AUTO_ENABLED is explicitly '0'.
function isAutoEnabled() {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem('SYNC_AUTO_ENABLED') !== AUTO_SYNC_KILL_SWITCH;
}

function dispatchEvent(provider, phase, detail) {
  window.dispatchEvent(new CustomEvent(`${provider}-sync-${phase}`, { detail }));
}

async function dispatchOutcomeEvent(provider, result) {
  switch (result?.outcome) {
    case 'synced':
      dispatchEvent(provider, 'completed', {
        tier: result.tier,
        receipts_stored: result.receipts_stored,
        items_added: result.items_added,
      });
      void logPhase(provider, SyncPhase.SYNC_SUCCEEDED, {
        mode: 'silent',
        metadata: {
          tier: result.tier,
          receipts_stored: result.receipts_stored ?? 0,
          items_added: result.items_added ?? 0,
        },
      });
      await Preferences.set({ key: `sync_lastRun_${provider}`, value: String(Date.now()) });
      break;
    case 'skipped':
      dispatchEvent(provider, 'skipped');
      void logPhase(provider, SyncPhase.SYNC_SKIPPED, {
        mode: 'silent',
        reason: result.reason || 'skipped',
      });
      break;
    case 'needs_reconnect':
      dispatchEvent(provider, 'needs-reconnect');
      void reportAnomaly(provider, SyncPhase.NEEDS_RECONNECT, {
        mode: 'silent',
        reason: result.message || 'needs_reconnect',
      });
      break;
    case 'error':
      dispatchEvent(provider, 'error', { message: result.message });
      void reportAnomaly(provider, SyncPhase.SYNC_FAILED, {
        mode: 'silent',
        reason: result.message || 'error',
      });
      break;
    default:
      dispatchEvent(provider, 'error', { message: 'Unknown sync outcome' });
      void reportAnomaly(provider, SyncPhase.SYNC_FAILED, {
        mode: 'silent',
        reason: 'unknown_outcome',
      });
      break;
  }
}

async function shouldRun(provider) {
  const { minResyncMsOverride } = readFlags();
  const threshold = minResyncMsOverride ?? DEFAULT_MIN_RESYNC_MS;
  const { value } = await Preferences.get({ key: `sync_lastRun_${provider}` });
  const last = value ? Number(value) : 0;
  return Date.now() - last >= threshold;
}

/**
 * Mounts app lifecycle listeners and triggers silent sync per provider when
 * appropriate. Must be mounted exactly once at the app root.
 *
 * @param {object} opts
 * @param {string|null} opts.userId
 */
export function useAppSyncScheduler({ userId }) {
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const syncingRef = useRef({ safeway: false, costco: false });
  const debounceRef = useRef(null);
  const mountTimerRef = useRef(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    if (!isAutoEnabled()) return undefined;

    mountedRef.current = true;

    const providers = [
      { name: 'safeway', hasTokens: hasSafewayTokens, run: runSafewaySilentSync },
      { name: 'costco', hasTokens: hasCostcoTokens, run: runCostcoSilentSync },
    ];

    async function maybeSyncAllProviders() {
      if (!mountedRef.current) return;
      if (!isAutoEnabled()) return;
      const uid = userIdRef.current;
      if (!uid) return;

      for (const p of providers) {
        try {
          if (syncingRef.current[p.name]) continue;
          if (!(await p.hasTokens())) continue;
          if (!(await shouldRun(p.name))) continue;

          syncingRef.current[p.name] = true;
          dispatchEvent(p.name, 'started');
          const result = await p.run(uid);
          await dispatchOutcomeEvent(p.name, result);
        } catch (err) {
          const msg = err?.message || String(err);
          void logPhase(p.name, SyncPhase.SYNC_FAILED, {
            mode: 'silent',
            reason: msg.slice(0, 500),
          });
          void reportAnomaly(p.name, SyncPhase.SYNC_FAILED, {
            mode: 'silent',
            reason: msg.slice(0, 500),
          });
          dispatchEvent(p.name, 'error', { message: msg });
        } finally {
          syncingRef.current[p.name] = false;
        }
      }
    }

    function scheduleMaybeSync() {
      if (!mountedRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void maybeSyncAllProviders();
      }, DEBOUNCE_MS);
    }

    if (userIdRef.current) {
      mountTimerRef.current = setTimeout(() => {
        void maybeSyncAllProviders();
      }, MOUNT_DELAY_MS);
    }

    const listenerPromise = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive === true) {
        scheduleMaybeSync();
      }
    });

    return () => {
      mountedRef.current = false;
      if (mountTimerRef.current) clearTimeout(mountTimerRef.current);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      listenerPromise.then((handle) => handle?.remove?.()).catch(() => {});
    };
  }, [userId]);
}
