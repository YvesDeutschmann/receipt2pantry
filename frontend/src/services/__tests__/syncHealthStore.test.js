import { describe, it, expect, vi, beforeEach } from 'vitest';

const { preferencesGetMock, preferencesSetMock } = vi.hoisted(() => ({
  preferencesGetMock: vi.fn(() => Promise.resolve({ value: null })),
  preferencesSetMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: (...args) => preferencesGetMock(...args),
    set: (...args) => preferencesSetMock(...args),
  },
}));

import {
  recordTerminalOutcome,
  getHealth,
  getAllHealth,
  setLastToastedOutcome,
  __resetHealthStoreForTests,
} from '../syncHealthStore';
import { setSyncUserId, __resetSyncPrefKeysForTests } from '../syncPrefKeys';

const USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const HEALTH_KEY = `sync_health_${USER_ID}`;

describe('syncHealthStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetSyncPrefKeysForTests();
    __resetHealthStoreForTests();
    setSyncUserId(USER_ID);
    preferencesGetMock.mockResolvedValue({ value: null });
    preferencesSetMock.mockResolvedValue(undefined);
  });

  it('RECORDS_COMPLETED_EMPTY', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    await recordTerminalOutcome('safeway', { outcome: 'completed_empty', receiptsStored: 0 });
    const health = await getHealth('safeway');
    expect(health).toEqual({
      lastAttemptAt: 1_700_000_000_000,
      lastOutcome: 'completed_empty',
      lastCompletedAt: 1_700_000_000_000,
      receiptsStored: 0,
      lastToastedOutcome: null,
    });
    nowSpy.mockRestore();
  });

  it('SKIPPED_IS_NOT_PERSISTED', async () => {
    await recordTerminalOutcome('safeway', { outcome: 'skipped' });
    const health = await getHealth('safeway');
    expect(health).toBeNull();
    expect(preferencesSetMock).not.toHaveBeenCalled();
  });

  it('PERSISTS_LAST_TOASTED_OUTCOME', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    await recordTerminalOutcome('costco', { outcome: 'failed' });
    await setLastToastedOutcome('costco', 'error');
    const health = await getHealth('costco');
    expect(health?.lastToastedOutcome).toBe('error');
    nowSpy.mockRestore();
  });

  it('DROPS_UNKNOWN_PROVIDERS_ON_READ', async () => {
    preferencesGetMock.mockResolvedValue({
      value: JSON.stringify({
        safeway: {
          lastAttemptAt: 100,
          lastOutcome: 'failed',
          lastCompletedAt: null,
          receiptsStored: 0,
          lastToastedOutcome: null,
        },
        kroger: {
          lastAttemptAt: 200,
          lastOutcome: 'failed',
          lastCompletedAt: null,
          receiptsStored: 0,
          lastToastedOutcome: null,
        },
      }),
    });
    const all = await getAllHealth();
    expect(all).toEqual({
      safeway: {
        lastAttemptAt: 100,
        lastOutcome: 'failed',
        lastCompletedAt: null,
        receiptsStored: 0,
        lastToastedOutcome: null,
      },
    });
  });
});
