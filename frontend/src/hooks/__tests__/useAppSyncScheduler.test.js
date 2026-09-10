import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const {
  isNativePlatformMock,
  addListenerMock,
  listenerRemoveMock,
  preferencesGetMock,
  preferencesSetMock,
  preferencesRemoveMock,
  preferencesStore,
  readFlagsMock,
  startSafewaySilentSyncMock,
  fetchSafewayReceiptsMock,
  startCostcoSilentSyncMock,
  hasSafewayTokensMock,
  hasCostcoTokensMock,
  isCostcoCooldownMock,
  setCostcoCooldownMock,
  isSafewayCooldownMock,
  setSafewayCooldownMock,
  clearCostcoReconnectCooldownMock,
} = vi.hoisted(() => {
  const preferencesStore = new Map();
  return {
  isNativePlatformMock: vi.fn(() => true),
  addListenerMock: vi.fn(),
  listenerRemoveMock: vi.fn(),
  preferencesStore,
  preferencesGetMock: vi.fn(({ key }) =>
    Promise.resolve({
      value: preferencesStore.has(key) ? preferencesStore.get(key) : null,
    })
  ),
  preferencesSetMock: vi.fn(({ key, value }) => {
    preferencesStore.set(key, value);
    return Promise.resolve();
  }),
  preferencesRemoveMock: vi.fn(({ key }) => {
    preferencesStore.delete(key);
    return Promise.resolve();
  }),
  readFlagsMock: vi.fn(() => ({ minResyncMsOverride: null })),
  startSafewaySilentSyncMock: vi.fn(),
  fetchSafewayReceiptsMock: vi.fn(() => Promise.resolve([])),
  startCostcoSilentSyncMock: vi.fn(),
  hasSafewayTokensMock: vi.fn(() => Promise.resolve(true)),
  hasCostcoTokensMock: vi.fn(() => Promise.resolve(true)),
  isCostcoCooldownMock: vi.fn(() => Promise.resolve(false)),
  setCostcoCooldownMock: vi.fn(() => Promise.resolve()),
  isSafewayCooldownMock: vi.fn(() => Promise.resolve(false)),
  setSafewayCooldownMock: vi.fn(() => Promise.resolve()),
  clearCostcoReconnectCooldownMock: vi.fn(() => Promise.resolve()),
  };
});

let appStateHandler = null;

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: (...args) => isNativePlatformMock(...args),
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (...args) => addListenerMock(...args),
  },
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: (...args) => preferencesGetMock(...args),
    set: (...args) => preferencesSetMock(...args),
    remove: (...args) => preferencesRemoveMock(...args),
  },
}));

vi.mock('../../services/syncDebugFlags', () => ({
  readFlags: (...args) => readFlagsMock(...args),
  redact: (v) => v,
}));

vi.mock('../../services/safewayWebViewBridge', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runSafewaySilentSync: undefined,
    hasStoredTokens: (...args) => hasSafewayTokensMock(...args),
    startSilentSync: (...args) => startSafewaySilentSyncMock(...args),
    fetchSafewayReceipts: (...args) => fetchSafewayReceiptsMock(...args),
    isSafewayReconnectCooldownActive: (...args) => isSafewayCooldownMock(...args),
    setSafewayReconnectCooldown: (...args) => setSafewayCooldownMock(...args),
    clearSafewayReconnectCooldown: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('../../services/costcoWebViewBridge', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runCostcoSilentSync: undefined,
    hasStoredTokens: (...args) => hasCostcoTokensMock(...args),
    startSilentSync: (...args) => startCostcoSilentSyncMock(...args),
    isCostcoReconnectCooldownActive: (...args) => isCostcoCooldownMock(...args),
    setCostcoReconnectCooldown: (...args) => setCostcoCooldownMock(...args),
    clearCostcoReconnectCooldown: (...args) => clearCostcoReconnectCooldownMock(...args),
  };
});

vi.mock('../../services/safewayReceiptParser', () => ({
  parseSafewayReceipt: (r) => r,
}));

vi.mock('../../services/costcoNativeSync', () => ({
  submitToBackend: vi.fn(() =>
    Promise.resolve({ receipts_stored: 1, items_added_to_pantry: 0, errors: [] })
  ),
}));

vi.mock('../../services/costcoSilentIngest', () => ({
  submitSilentReceipts: vi.fn(() =>
    Promise.resolve({ receipts_stored: 1, items_added_to_pantry: 0, errors: [] })
  ),
}));

vi.mock('../../services/apiClient', () => ({
  api: {
    getReceipts: vi.fn(() => Promise.resolve({ receipts: [] })),
    ingestReceipts: vi.fn(),
    connectCostcoFromApp: vi.fn(),
    suggestions: { triggerGeneration: vi.fn(() => Promise.resolve()) },
  },
}));

vi.mock('../../services/syncEventLog', () => ({
  logPhase: vi.fn(() => Promise.resolve()),
  reportAnomaly: vi.fn(() => Promise.resolve()),
  SyncPhase: {},
}));

import { useAppSyncScheduler } from '../useAppSyncScheduler';
import { setSyncUserId, __resetSyncPrefKeysForTests } from '../../services/syncPrefKeys';

const userId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const namespacedSafewayLastRun = `sync_lastRun_safeway_${userId}`;
const namespacedCostcoLastRun = `sync_lastRun_costco_${userId}`;

function setupListenerCapture() {
  addListenerMock.mockImplementation((_event, handler) => {
    if (_event === 'appStateChange') {
      appStateHandler = handler;
    }
    return Promise.resolve({ remove: listenerRemoveMock });
  });
}

async function flushMountAndDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(250);
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function simulateAppActive() {
  await act(async () => {
    appStateHandler?.({ isActive: true });
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useAppSyncScheduler', () => {
  /** @type {Map<string, string>} */
  let lsStore;

  beforeEach(() => {
    __resetSyncPrefKeysForTests();
    setSyncUserId(userId);
    preferencesStore.clear();
    lsStore = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
      setItem: (k, v) => {
        lsStore.set(k, String(v));
      },
      removeItem: (k) => {
        lsStore.delete(k);
      },
      clear: () => lsStore.clear(),
      key: (i) => [...lsStore.keys()][i] ?? null,
      get length() {
        return lsStore.size;
      },
    });

    vi.useFakeTimers();
    vi.clearAllMocks();
    appStateHandler = null;
    isNativePlatformMock.mockReturnValue(true);
    localStorage.removeItem('SYNC_AUTO_ENABLED');
    readFlagsMock.mockReturnValue({ minResyncMsOverride: null });
    preferencesGetMock.mockImplementation(({ key }) =>
      Promise.resolve({
        value: preferencesStore.has(key) ? preferencesStore.get(key) : null,
      })
    );
    preferencesSetMock.mockImplementation(({ key, value }) => {
      preferencesStore.set(key, value);
      return Promise.resolve();
    });
    preferencesRemoveMock.mockImplementation(({ key }) => {
      preferencesStore.delete(key);
      return Promise.resolve();
    });
    hasSafewayTokensMock.mockResolvedValue(true);
    hasCostcoTokensMock.mockResolvedValue(true);
    isCostcoCooldownMock.mockResolvedValue(false);
    isSafewayCooldownMock.mockResolvedValue(false);
    setCostcoCooldownMock.mockClear();
    setSafewayCooldownMock.mockClear();
    fetchSafewayReceiptsMock.mockResolvedValue([]);
    startSafewaySilentSyncMock.mockResolvedValue({
      accessToken: 'tok',
      clubCard: '999',
    });
    startCostcoSilentSyncMock.mockResolvedValue({
      receipts: [{ order_id: 'c1' }],
      idToken: 'costco-id',
      _fromWebView: true,
    });
    setupListenerCapture();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('NOOP_OFF_NATIVE — no listeners registered, no runs', async () => {
    isNativePlatformMock.mockReturnValue(false);
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(addListenerMock).not.toHaveBeenCalled();
    expect(startSafewaySilentSyncMock).not.toHaveBeenCalled();
  });

  it('NOOP_WHEN_KILL_SWITCH_ON — addListener not called', () => {
    localStorage.setItem('SYNC_AUTO_ENABLED', '0');
    renderHook(() => useAppSyncScheduler({ userId }));
    expect(addListenerMock).not.toHaveBeenCalled();
  });

  it('AUTO_ENABLED_WHEN_FLAG_ABSENT — scheduler runs on mount', async () => {
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(startSafewaySilentSyncMock).toHaveBeenCalled();
  });

  it('AUTO_ENABLED_WHEN_FLAG_IS_1 — scheduler runs', async () => {
    localStorage.setItem('SYNC_AUTO_ENABLED', '1');
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(startSafewaySilentSyncMock).toHaveBeenCalled();
  });

  it('NOOP_WHEN_USER_ID_NULL — no provider run', async () => {
    renderHook(() => useAppSyncScheduler({ userId: null }));
    await flushMountAndDebounce();
    expect(startSafewaySilentSyncMock).not.toHaveBeenCalled();
    expect(startCostcoSilentSyncMock).not.toHaveBeenCalled();
  });

  it('RUNS_ON_MOUNT_AFTER_AUTH_SETTLED — startSilentSync once after MOUNT_DELAY_MS', async () => {
    renderHook(() => useAppSyncScheduler({ userId }));
    await act(async () => {
      vi.advanceTimersByTime(249);
      await Promise.resolve();
    });
    expect(startSafewaySilentSyncMock).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(startSafewaySilentSyncMock).toHaveBeenCalledTimes(1);
  });

  it('RUNS_ON_APP_STATE_ACTIVE_TRUE — provider run triggered', async () => {
    renderHook(() => useAppSyncScheduler({ userId }));
    startSafewaySilentSyncMock.mockClear();
    startCostcoSilentSyncMock.mockClear();
    await simulateAppActive();
    expect(startSafewaySilentSyncMock).toHaveBeenCalled();
  });

  it('DOES_NOT_RUN_ON_APP_STATE_INACTIVE — no run', async () => {
    renderHook(() => useAppSyncScheduler({ userId }));
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
      await Promise.resolve();
    });
    startSafewaySilentSyncMock.mockClear();
    await act(async () => {
      appStateHandler?.({ isActive: false });
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(startSafewaySilentSyncMock).not.toHaveBeenCalled();
  });

  it('DEBOUNCES_RAPID_APP_STATE_EVENTS — exactly one run', async () => {
    renderHook(() => useAppSyncScheduler({ userId }));
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
      await Promise.resolve();
    });
    startSafewaySilentSyncMock.mockClear();
    preferencesStore.clear();
    await act(async () => {
      appStateHandler?.({ isActive: true });
      appStateHandler?.({ isActive: true });
      appStateHandler?.({ isActive: true });
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(startSafewaySilentSyncMock).toHaveBeenCalledTimes(1);
  });

  it('SHOULD_RUN_DELETES_UNSCOPED_LASTRUN', async () => {
    const legacyTimestamp = '1700000000000';
    preferencesStore.set('sync_lastRun_safeway', legacyTimestamp);
    preferencesStore.set('sync_lastRun_costco', legacyTimestamp);

    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();

    expect(preferencesStore.has('sync_lastRun_safeway')).toBe(false);
    expect(preferencesRemoveMock).toHaveBeenCalledWith({ key: 'sync_lastRun_safeway' });
    const namespaced = preferencesStore.get(namespacedSafewayLastRun);
    if (namespaced !== undefined) {
      expect(namespaced).not.toBe(legacyTimestamp);
    }
  });

  it('SKIPS_WHEN_THROTTLE_NOT_EXPIRED — safeway skipped, costco runs', async () => {
    preferencesGetMock.mockImplementation(({ key }) => {
      if (key === namespacedSafewayLastRun) {
        return Promise.resolve({ value: String(Date.now() - 30 * 60 * 1000) });
      }
      return Promise.resolve({ value: null });
    });
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(startSafewaySilentSyncMock).not.toHaveBeenCalled();
    expect(startCostcoSilentSyncMock).toHaveBeenCalled();
  });

  it('MIN_RESYNC_OVERRIDE_ZERO_ALWAYS_RUNS — run still triggers', async () => {
    readFlagsMock.mockReturnValue({ minResyncMsOverride: 0 });
    preferencesGetMock.mockResolvedValue({ value: String(Date.now()) });
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(startSafewaySilentSyncMock).toHaveBeenCalled();
  });

  it('SKIPS_PROVIDER_WITHOUT_STORED_TOKENS — only Costco runs', async () => {
    hasSafewayTokensMock.mockResolvedValue(false);
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(startSafewaySilentSyncMock).not.toHaveBeenCalled();
    expect(startCostcoSilentSyncMock).toHaveBeenCalled();
  });

  it('WRITES_SYNC_LAST_RUN_ON_SYNCED_OUTCOME', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(preferencesSetMock).toHaveBeenCalledWith({
      key: namespacedSafewayLastRun,
      value: '1700000000000',
    });
    nowSpy.mockRestore();
  });

  it('DOES_NOT_WRITE_LAST_RUN_ON_NEEDS_RECONNECT', async () => {
    startSafewaySilentSyncMock.mockResolvedValue({
      needs_reconnect: true,
      reason: 'missing_session_cookie',
    });
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(preferencesSetMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: namespacedSafewayLastRun })
    );
  });

  it('DOES_NOT_WRITE_LAST_RUN_ON_SKIPPED', async () => {
    hasCostcoTokensMock.mockResolvedValue(false);
    startSafewaySilentSyncMock.mockResolvedValue({ _skipped: true, reason: 'webview_busy' });
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(preferencesSetMock).not.toHaveBeenCalled();
  });

  it('DOES_NOT_WRITE_LAST_RUN_ON_ERROR_OUTCOME', async () => {
    hasCostcoTokensMock.mockResolvedValue(false);
    startSafewaySilentSyncMock.mockResolvedValue(null);
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(preferencesSetMock).not.toHaveBeenCalled();
  });

  it('DISPATCHES_STARTED_THEN_COMPLETED_IN_ORDER', async () => {
    const events = [];
    const spy = vi.spyOn(window, 'dispatchEvent').mockImplementation((ev) => {
      if (ev.type?.startsWith('safeway-sync-')) events.push(ev.type);
      return true;
    });
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(events.indexOf('safeway-sync-started')).toBeLessThan(
      events.indexOf('safeway-sync-completed')
    );
    expect(events.filter((t) => t === 'safeway-sync-started')).toHaveLength(1);
    spy.mockRestore();
  });

  it('DISPATCHES_NEEDS_RECONNECT_EVENT', async () => {
    startSafewaySilentSyncMock.mockResolvedValue({
      needs_reconnect: true,
      reason: 'missing_session_cookie',
    });
    const listener = vi.fn();
    window.addEventListener('safeway-sync-needs-reconnect', listener);
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(listener).toHaveBeenCalled();
    expect(setSafewayCooldownMock).toHaveBeenCalled();
    window.removeEventListener('safeway-sync-needs-reconnect', listener);
  });

  it('SAFEWAY_NEEDS_RECONNECT_SETS_COOLDOWN_WITHOUT_LAST_RUN', async () => {
    hasCostcoTokensMock.mockResolvedValue(false);
    startSafewaySilentSyncMock.mockResolvedValue({
      needs_reconnect: true,
      reason: 'missing_session_cookie',
    });
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(setSafewayCooldownMock).toHaveBeenCalled();
    expect(preferencesSetMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: namespacedSafewayLastRun })
    );
  });

  it('SAFEWAY_TIMEOUT_NOT_RECONNECT_OR_COOLDOWN', async () => {
    hasCostcoTokensMock.mockResolvedValue(false);
    startSafewaySilentSyncMock.mockResolvedValue(null);
    const reconnectListener = vi.fn();
    const errorListener = vi.fn();
    window.addEventListener('safeway-sync-needs-reconnect', reconnectListener);
    window.addEventListener('safeway-sync-error', errorListener);
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(reconnectListener).not.toHaveBeenCalled();
    expect(setSafewayCooldownMock).not.toHaveBeenCalled();
    expect(errorListener).toHaveBeenCalled();
    window.removeEventListener('safeway-sync-needs-reconnect', reconnectListener);
    window.removeEventListener('safeway-sync-error', errorListener);
  });

  it('SAFEWAY_FETCH_ORDER_ID_401_IS_FAILED_NOT_RECONNECT', async () => {
    hasCostcoTokensMock.mockResolvedValue(false);
    fetchSafewayReceiptsMock.mockRejectedValue(new Error('order 401123'));
    const reconnectListener = vi.fn();
    const errorListener = vi.fn();
    const completedListener = vi.fn();
    window.addEventListener('safeway-sync-needs-reconnect', reconnectListener);
    window.addEventListener('safeway-sync-error', errorListener);
    window.addEventListener('safeway-sync-completed', completedListener);
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(setSafewayCooldownMock).not.toHaveBeenCalled();
    expect(reconnectListener).not.toHaveBeenCalled();
    expect(errorListener).toHaveBeenCalled();
    expect(errorListener.mock.calls[0][0].detail.outcome).toBe('failed');
    expect(completedListener).not.toHaveBeenCalled();
    window.removeEventListener('safeway-sync-needs-reconnect', reconnectListener);
    window.removeEventListener('safeway-sync-error', errorListener);
    window.removeEventListener('safeway-sync-completed', completedListener);
  });

  it('SAFEWAY_COOLDOWN_SKIPS_BEFORE_SILENT', async () => {
    hasCostcoTokensMock.mockResolvedValue(false);
    isSafewayCooldownMock.mockResolvedValue(true);
    const skippedListener = vi.fn();
    window.addEventListener('safeway-sync-skipped', skippedListener);
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(startSafewaySilentSyncMock).not.toHaveBeenCalled();
    expect(skippedListener).toHaveBeenCalled();
    window.removeEventListener('safeway-sync-skipped', skippedListener);
  });

  it('DISPATCHES_ERROR_EVENT_ON_THROW', async () => {
    startSafewaySilentSyncMock.mockRejectedValue(new Error('sync blew up'));
    const listener = vi.fn();
    window.addEventListener('safeway-sync-error', listener);
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls[0][0].detail.message).toBe('sync blew up');
    window.removeEventListener('safeway-sync-error', listener);
  });

  it('DISPATCHES_SKIPPED_EVENT', async () => {
    startSafewaySilentSyncMock.mockResolvedValue({ _skipped: true, reason: 'webview_busy' });
    const listener = vi.fn();
    window.addEventListener('safeway-sync-skipped', listener);
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(listener).toHaveBeenCalled();
    window.removeEventListener('safeway-sync-skipped', listener);
  });

  it('COSTCO_SKIPPED_NOT_NEEDS_RECONNECT — skipped event only, no lastRun write', async () => {
    hasSafewayTokensMock.mockResolvedValue(false);
    startCostcoSilentSyncMock.mockResolvedValue({ _skipped: true, reason: 'webview_busy' });
    const skippedListener = vi.fn();
    const reconnectListener = vi.fn();
    window.addEventListener('costco-sync-skipped', skippedListener);
    window.addEventListener('costco-sync-needs-reconnect', reconnectListener);
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(skippedListener).toHaveBeenCalled();
    expect(reconnectListener).not.toHaveBeenCalled();
    expect(preferencesSetMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: namespacedCostcoLastRun })
    );
    window.removeEventListener('costco-sync-skipped', skippedListener);
    window.removeEventListener('costco-sync-needs-reconnect', reconnectListener);
  });

  it('COSTCO_NEEDS_RECONNECT_SETS_COOLDOWN_WITHOUT_LAST_RUN', async () => {
    hasSafewayTokensMock.mockResolvedValue(false);
    startCostcoSilentSyncMock.mockResolvedValue({
      needs_reconnect: true,
      reason: 'refresh_invalid_grant',
    });
    const reconnectListener = vi.fn();
    window.addEventListener('costco-sync-needs-reconnect', reconnectListener);
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(reconnectListener).toHaveBeenCalled();
    expect(setCostcoCooldownMock).toHaveBeenCalled();
    expect(preferencesSetMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: namespacedCostcoLastRun })
    );
    window.removeEventListener('costco-sync-needs-reconnect', reconnectListener);
  });

  it('COSTCO_TIMEOUT_NOT_RECONNECT_OR_COOLDOWN', async () => {
    hasSafewayTokensMock.mockResolvedValue(false);
    startCostcoSilentSyncMock.mockResolvedValue(null);
    const reconnectListener = vi.fn();
    const errorListener = vi.fn();
    window.addEventListener('costco-sync-needs-reconnect', reconnectListener);
    window.addEventListener('costco-sync-error', errorListener);
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(reconnectListener).not.toHaveBeenCalled();
    expect(setCostcoCooldownMock).not.toHaveBeenCalled();
    expect(errorListener).toHaveBeenCalled();
    window.removeEventListener('costco-sync-needs-reconnect', reconnectListener);
    window.removeEventListener('costco-sync-error', errorListener);
  });

  it('COSTCO_TOKENS_ONLY_NOT_COOLDOWN', async () => {
    hasSafewayTokensMock.mockResolvedValue(false);
    startCostcoSilentSyncMock.mockResolvedValue({ idToken: 'x', _tokensOnly: true });
    const reconnectListener = vi.fn();
    const errorListener = vi.fn();
    window.addEventListener('costco-sync-needs-reconnect', reconnectListener);
    window.addEventListener('costco-sync-error', errorListener);
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(reconnectListener).not.toHaveBeenCalled();
    expect(setCostcoCooldownMock).not.toHaveBeenCalled();
    expect(errorListener).toHaveBeenCalled();
    window.removeEventListener('costco-sync-needs-reconnect', reconnectListener);
    window.removeEventListener('costco-sync-error', errorListener);
  });

  it('SEQUENTIAL_NOT_PARALLEL — costco starts after safeway resolves', async () => {
    const order = [];
    startSafewaySilentSyncMock.mockImplementation(async () => {
      order.push('safeway-start');
      await Promise.resolve();
      order.push('safeway-end');
      return { accessToken: 'tok', clubCard: '999' };
    });
    startCostcoSilentSyncMock.mockImplementation(async () => {
      order.push('costco-start');
      return {
        receipts: [{ order_id: 'c1' }],
        idToken: 'costco-id',
        _fromWebView: true,
      };
    });
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(order).toEqual(['safeway-start', 'safeway-end', 'costco-start']);
  });

  it('IN_FLIGHT_GUARD_SKIPS_CONCURRENT_TRIGGER', async () => {
    let resolveSafeway;
    startSafewaySilentSyncMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSafeway = () => resolve({ accessToken: 'tok', clubCard: '999' });
        })
    );
    renderHook(() => useAppSyncScheduler({ userId }));
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });
    await act(async () => {
      appStateHandler?.({ isActive: true });
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(startSafewaySilentSyncMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveSafeway?.();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('LISTENERS_REMOVED_ON_UNMOUNT — no runs after unmount', async () => {
    const { unmount } = renderHook(() => useAppSyncScheduler({ userId }));
    unmount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    startSafewaySilentSyncMock.mockClear();
    await act(async () => {
      appStateHandler?.({ isActive: true });
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(startSafewaySilentSyncMock).not.toHaveBeenCalled();
    expect(listenerRemoveMock).toHaveBeenCalled();
  });

  it('KILL_SWITCH_RE_CHECKED_AT_RUNTIME — no run after flag set to 0', async () => {
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    startSafewaySilentSyncMock.mockClear();
    localStorage.setItem('SYNC_AUTO_ENABLED', '0');
    await simulateAppActive();
    expect(startSafewaySilentSyncMock).not.toHaveBeenCalled();
  });

  it('EMPTY_WITHOUT_TERMINAL_RESPONSE_DOES_NOT_CLEAR_COOLDOWN', async () => {
    hasSafewayTokensMock.mockResolvedValue(false);
    clearCostcoReconnectCooldownMock.mockClear();
    startCostcoSilentSyncMock.mockResolvedValue({ receipts: [] });
    const completedListener = vi.fn();
    const errorListener = vi.fn();
    window.addEventListener('costco-sync-completed', completedListener);
    window.addEventListener('costco-sync-error', errorListener);
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(clearCostcoReconnectCooldownMock).not.toHaveBeenCalled();
    expect(preferencesSetMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: namespacedCostcoLastRun })
    );
    expect(completedListener).not.toHaveBeenCalled();
    expect(errorListener).toHaveBeenCalled();
    window.removeEventListener('costco-sync-completed', completedListener);
    window.removeEventListener('costco-sync-error', errorListener);
  });

  it('COMPLETED_EMPTY_FROM_WEBVIEW_WRITES_LASTRUN', async () => {
    hasSafewayTokensMock.mockResolvedValue(false);
    clearCostcoReconnectCooldownMock.mockClear();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    startCostcoSilentSyncMock.mockResolvedValue({ receipts: [], _fromWebView: true });
    const completedListener = vi.fn();
    window.addEventListener('costco-sync-completed', completedListener);
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(clearCostcoReconnectCooldownMock).toHaveBeenCalled();
    expect(preferencesSetMock).toHaveBeenCalledWith({
      key: namespacedCostcoLastRun,
      value: '1700000000000',
    });
    expect(completedListener).toHaveBeenCalled();
    expect(completedListener.mock.calls[0][0].detail.outcome).toBe('completed_empty');
    nowSpy.mockRestore();
    window.removeEventListener('costco-sync-completed', completedListener);
  });
});
