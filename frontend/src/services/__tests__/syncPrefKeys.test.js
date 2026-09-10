import { describe, it, expect, vi, beforeEach } from 'vitest';

const { preferencesStore, preferencesGetMock, preferencesSetMock, preferencesRemoveMock } =
  vi.hoisted(() => {
    const preferencesStore = new Map();
    return {
      preferencesStore,
      preferencesGetMock: vi.fn(({ key }) =>
        Promise.resolve({ value: preferencesStore.has(key) ? preferencesStore.get(key) : null })
      ),
      preferencesSetMock: vi.fn(({ key, value }) => {
        preferencesStore.set(key, value);
        return Promise.resolve();
      }),
      preferencesRemoveMock: vi.fn(({ key }) => {
        preferencesStore.delete(key);
        return Promise.resolve();
      }),
    };
  });

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: (...args) => preferencesGetMock(...args),
    set: (...args) => preferencesSetMock(...args),
    remove: (...args) => preferencesRemoveMock(...args),
  },
}));

import {
  setSyncUserId,
  lastRunKey,
  attentionKey,
  telemetryKey,
  clearUserSyncState,
  writeLastRun,
  __resetSyncPrefKeysForTests,
} from '../syncPrefKeys';
import { setNeedsReconnect, getAttention, __resetAttentionStoreForTests } from '../providerAttentionStore';

const USER_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const USER_B = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';

describe('syncPrefKeys', () => {
  beforeEach(() => {
    preferencesStore.clear();
    vi.clearAllMocks();
    __resetSyncPrefKeysForTests();
    __resetAttentionStoreForTests();
  });

  it('SIGN_OUT_CLEARS_SYNC_STATE', async () => {
    setSyncUserId(USER_A);
    const lastRun = lastRunKey('safeway');
    const attention = attentionKey();
    const telemetry = telemetryKey('costco');

    await clearUserSyncState(USER_A);

    expect(preferencesRemoveMock).toHaveBeenCalledWith({ key: `sync_lastRun_safeway_${USER_A}` });
    expect(preferencesRemoveMock).toHaveBeenCalledWith({ key: `sync_lastRun_costco_${USER_A}` });
    expect(preferencesRemoveMock).toHaveBeenCalledWith({ key: `sync_attention_${USER_A}` });
    expect(preferencesRemoveMock).toHaveBeenCalledWith({ key: `sync_health_${USER_A}` });
    expect(preferencesRemoveMock).toHaveBeenCalledWith({ key: `sync_telemetry_safeway_${USER_A}` });
    expect(preferencesRemoveMock).toHaveBeenCalledWith({ key: `sync_telemetry_costco_${USER_A}` });
    expect(lastRun).toBe(`sync_lastRun_safeway_${USER_A}`);
    expect(attention).toBe(`sync_attention_${USER_A}`);
    expect(telemetry).toBe(`sync_telemetry_costco_${USER_A}`);
  });

  it('SECOND_USER_DOES_NOT_INHERIT_ATTENTION', async () => {
    setSyncUserId(USER_A);
    await setNeedsReconnect('safeway');

    setSyncUserId(null);
    await clearUserSyncState(USER_A);

    setSyncUserId(USER_B);
    const items = await getAttention();
    expect(items).toEqual({});
  });

  it('WRITE_LASTRUN_NOOP_WITHOUT_USER_ID', async () => {
    await writeLastRun('costco');
    expect(preferencesSetMock).not.toHaveBeenCalled();
  });

  it('WRITE_LASTRUN_SETS_NAMESPACED_KEY', async () => {
    setSyncUserId(USER_A);
    await writeLastRun('safeway');
    expect(preferencesSetMock).toHaveBeenCalledWith({
      key: `sync_lastRun_safeway_${USER_A}`,
      value: expect.stringMatching(/^\d+$/),
    });
  });

  it('FIRST_LASTRUN_READ_DELETES_LEGACY_NOT_COPY', async () => {
    const legacyTimestamp = '1700000000000';
    preferencesStore.set('sync_lastRun_safeway', legacyTimestamp);

    setSyncUserId(USER_A);
    await writeLastRun('safeway');

    expect(preferencesStore.has('sync_lastRun_safeway')).toBe(false);
    const namespaced = preferencesStore.get(`sync_lastRun_safeway_${USER_A}`);
    expect(namespaced).toBeDefined();
    expect(namespaced).not.toBe(legacyTimestamp);
  });

  it('LEGACY_UNSCOPED_KEYS_ARE_DELETED_NOT_COPIED', async () => {
    preferencesStore.set('sync_attention', JSON.stringify({ safeway: { kind: 'needs_reconnect', updatedAt: 1 } }));
    preferencesStore.set('sync_lastRun_safeway', '1700000000000');

    setSyncUserId(USER_A);
    await clearUserSyncState(USER_A);

    expect(preferencesStore.has('sync_attention')).toBe(false);
    expect(preferencesStore.has('sync_lastRun_safeway')).toBe(false);
    expect(preferencesStore.has(`sync_attention_${USER_A}`)).toBe(false);
  });
});
