import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const {
  isNativePlatformMock,
  addListenerMock,
  listenerRemoveMock,
  preferencesGetMock,
  preferencesSetMock,
  readFlagsMock,
  runSafewaySilentSyncMock,
  startCostcoSilentSyncMock,
  hasSafewayTokensMock,
  hasCostcoTokensMock,
  isCostcoCooldownMock,
  setCostcoCooldownMock,
} = vi.hoisted(() => ({
  isNativePlatformMock: vi.fn(() => true),
  addListenerMock: vi.fn(),
  listenerRemoveMock: vi.fn(),
  preferencesGetMock: vi.fn(() => Promise.resolve({ value: null })),
  preferencesSetMock: vi.fn(() => Promise.resolve()),
  readFlagsMock: vi.fn(() => ({ minResyncMsOverride: null })),
  runSafewaySilentSyncMock: vi.fn(),
  startCostcoSilentSyncMock: vi.fn(),
  hasSafewayTokensMock: vi.fn(() => Promise.resolve(true)),
  hasCostcoTokensMock: vi.fn(() => Promise.resolve(true)),
  isCostcoCooldownMock: vi.fn(() => Promise.resolve(false)),
  setCostcoCooldownMock: vi.fn(() => Promise.resolve()),
}));

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
  },
}));

vi.mock('../../services/syncDebugFlags', () => ({
  readFlags: (...args) => readFlagsMock(...args),
  redact: (v) => v,
}));

vi.mock('../../services/safewayWebViewBridge', () => ({
  runSafewaySilentSync: (...args) => runSafewaySilentSyncMock(...args),
  hasStoredTokens: (...args) => hasSafewayTokensMock(...args),
  startSilentSync: vi.fn(),
  fetchSafewayReceipts: vi.fn(),
}));

vi.mock('../../services/costcoWebViewBridge', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runCostcoSilentSync: undefined,
    hasStoredTokens: (...args) => hasCostcoTokensMock(...args),
    startSilentSync: (...args) => startCostcoSilentSyncMock(...args),
    isCostcoReconnectCooldownActive: (...args) => isCostcoCooldownMock(...args),
    setCostcoReconnectCooldown: (...args) => setCostcoCooldownMock(...args),
    clearCostcoReconnectCooldown: vi.fn(() => Promise.resolve()),
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

const userId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

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
    preferencesGetMock.mockResolvedValue({ value: null });
    preferencesSetMock.mockResolvedValue(undefined);
    hasSafewayTokensMock.mockResolvedValue(true);
    hasCostcoTokensMock.mockResolvedValue(true);
    runSafewaySilentSyncMock.mockResolvedValue({
      outcome: 'synced',
      tier: 'silent',
      receipts_stored: 1,
      items_added: 0,
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
    expect(runSafewaySilentSyncMock).not.toHaveBeenCalled();
  });

  it('NOOP_WHEN_KILL_SWITCH_ON — addListener not called', () => {
    localStorage.setItem('SYNC_AUTO_ENABLED', '0');
    renderHook(() => useAppSyncScheduler({ userId }));
    expect(addListenerMock).not.toHaveBeenCalled();
  });

  it('AUTO_ENABLED_WHEN_FLAG_ABSENT — scheduler runs on mount', async () => {
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(runSafewaySilentSyncMock).toHaveBeenCalledWith(userId);
  });

  it('AUTO_ENABLED_WHEN_FLAG_IS_1 — scheduler runs', async () => {
    localStorage.setItem('SYNC_AUTO_ENABLED', '1');
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(runSafewaySilentSyncMock).toHaveBeenCalled();
  });

  it('NOOP_WHEN_USER_ID_NULL — no provider run', async () => {
    renderHook(() => useAppSyncScheduler({ userId: null }));
    await flushMountAndDebounce();
    expect(runSafewaySilentSyncMock).not.toHaveBeenCalled();
    expect(startCostcoSilentSyncMock).not.toHaveBeenCalled();
  });

  it('RUNS_ON_MOUNT_AFTER_AUTH_SETTLED — runSafewaySilentSync once after MOUNT_DELAY_MS', async () => {
    renderHook(() => useAppSyncScheduler({ userId }));
    await act(async () => {
      vi.advanceTimersByTime(249);
      await Promise.resolve();
    });
    expect(runSafewaySilentSyncMock).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(runSafewaySilentSyncMock).toHaveBeenCalledTimes(1);
  });

  it('RUNS_ON_APP_STATE_ACTIVE_TRUE — provider run triggered', async () => {
    renderHook(() => useAppSyncScheduler({ userId }));
    runSafewaySilentSyncMock.mockClear();
    startCostcoSilentSyncMock.mockClear();
    await simulateAppActive();
    expect(runSafewaySilentSyncMock).toHaveBeenCalled();
  });

  it('DOES_NOT_RUN_ON_APP_STATE_INACTIVE — no run', async () => {
    renderHook(() => useAppSyncScheduler({ userId }));
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
      await Promise.resolve();
    });
    runSafewaySilentSyncMock.mockClear();
    await act(async () => {
      appStateHandler?.({ isActive: false });
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(runSafewaySilentSyncMock).not.toHaveBeenCalled();
  });

  it('DEBOUNCES_RAPID_APP_STATE_EVENTS — exactly one run', async () => {
    renderHook(() => useAppSyncScheduler({ userId }));
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
      await Promise.resolve();
    });
    runSafewaySilentSyncMock.mockClear();
    await act(async () => {
      appStateHandler?.({ isActive: true });
      appStateHandler?.({ isActive: true });
      appStateHandler?.({ isActive: true });
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(runSafewaySilentSyncMock).toHaveBeenCalledTimes(1);
  });

  it('SKIPS_WHEN_THROTTLE_NOT_EXPIRED — safeway skipped, costco runs', async () => {
    preferencesGetMock.mockImplementation(({ key }) => {
      if (key === 'sync_lastRun_safeway') {
        return Promise.resolve({ value: String(Date.now() - 30 * 60 * 1000) });
      }
      return Promise.resolve({ value: null });
    });
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(runSafewaySilentSyncMock).not.toHaveBeenCalled();
    expect(startCostcoSilentSyncMock).toHaveBeenCalled();
  });

  it('MIN_RESYNC_OVERRIDE_ZERO_ALWAYS_RUNS — run still triggers', async () => {
    readFlagsMock.mockReturnValue({ minResyncMsOverride: 0 });
    preferencesGetMock.mockResolvedValue({ value: String(Date.now()) });
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(runSafewaySilentSyncMock).toHaveBeenCalled();
  });

  it('SKIPS_PROVIDER_WITHOUT_STORED_TOKENS — only Costco runs', async () => {
    hasSafewayTokensMock.mockResolvedValue(false);
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(runSafewaySilentSyncMock).not.toHaveBeenCalled();
    expect(startCostcoSilentSyncMock).toHaveBeenCalled();
  });

  it('WRITES_SYNC_LAST_RUN_ON_SYNCED_OUTCOME', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(preferencesSetMock).toHaveBeenCalledWith({
      key: 'sync_lastRun_safeway',
      value: '1700000000000',
    });
    nowSpy.mockRestore();
  });

  it('DOES_NOT_WRITE_LAST_RUN_ON_NEEDS_RECONNECT', async () => {
    runSafewaySilentSyncMock.mockResolvedValue({ outcome: 'needs_reconnect' });
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(preferencesSetMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: 'sync_lastRun_safeway' })
    );
  });

  it('DOES_NOT_WRITE_LAST_RUN_ON_SKIPPED', async () => {
    hasCostcoTokensMock.mockResolvedValue(false);
    runSafewaySilentSyncMock.mockResolvedValue({ outcome: 'skipped' });
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(preferencesSetMock).not.toHaveBeenCalled();
  });

  it('DOES_NOT_WRITE_LAST_RUN_ON_ERROR_OUTCOME', async () => {
    hasCostcoTokensMock.mockResolvedValue(false);
    runSafewaySilentSyncMock.mockResolvedValue({ outcome: 'error', message: 'boom' });
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
    runSafewaySilentSyncMock.mockResolvedValue({ outcome: 'needs_reconnect' });
    const listener = vi.fn();
    window.addEventListener('safeway-sync-needs-reconnect', listener);
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(listener).toHaveBeenCalled();
    window.removeEventListener('safeway-sync-needs-reconnect', listener);
  });

  it('DISPATCHES_ERROR_EVENT_ON_THROW', async () => {
    runSafewaySilentSyncMock.mockRejectedValue(new Error('sync blew up'));
    const listener = vi.fn();
    window.addEventListener('safeway-sync-error', listener);
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls[0][0].detail.message).toBe('sync blew up');
    window.removeEventListener('safeway-sync-error', listener);
  });

  it('DISPATCHES_SKIPPED_EVENT', async () => {
    runSafewaySilentSyncMock.mockResolvedValue({ outcome: 'skipped' });
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
      expect.objectContaining({ key: 'sync_lastRun_costco' })
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
      expect.objectContaining({ key: 'sync_lastRun_costco' })
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
    runSafewaySilentSyncMock.mockImplementation(async () => {
      order.push('safeway-start');
      await Promise.resolve();
      order.push('safeway-end');
      return { outcome: 'synced', tier: 'silent', receipts_stored: 0, items_added: 0 };
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
    runSafewaySilentSyncMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSafeway = () =>
            resolve({ outcome: 'synced', tier: 'silent', receipts_stored: 0, items_added: 0 });
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
    expect(runSafewaySilentSyncMock).toHaveBeenCalledTimes(1);
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
    runSafewaySilentSyncMock.mockClear();
    await act(async () => {
      appStateHandler?.({ isActive: true });
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(runSafewaySilentSyncMock).not.toHaveBeenCalled();
    expect(listenerRemoveMock).toHaveBeenCalled();
  });

  it('KILL_SWITCH_RE_CHECKED_AT_RUNTIME — no run after flag set to 0', async () => {
    renderHook(() => useAppSyncScheduler({ userId }));
    await flushMountAndDebounce();
    runSafewaySilentSyncMock.mockClear();
    localStorage.setItem('SYNC_AUTO_ENABLED', '0');
    await simulateAppActive();
    expect(runSafewaySilentSyncMock).not.toHaveBeenCalled();
  });
});
