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
  getAttention,
  setNeedsReconnect,
  clearProvider,
  subscribe,
  PREF_KEY,
  __resetAttentionStoreForTests,
} from '../providerAttentionStore';

describe('providerAttentionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetAttentionStoreForTests();
    preferencesGetMock.mockResolvedValue({ value: null });
    preferencesSetMock.mockResolvedValue(undefined);
  });

  it('SET_ON_NEEDS_RECONNECT', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    await setNeedsReconnect('safeway');
    expect(preferencesSetMock).toHaveBeenCalledWith({
      key: PREF_KEY,
      value: JSON.stringify({
        safeway: { kind: 'needs_reconnect', updatedAt: 1_700_000_000_000 },
      }),
    });
    nowSpy.mockRestore();
  });

  it('CLEAR_ON_COMPLETED', async () => {
    await setNeedsReconnect('safeway');
    preferencesSetMock.mockClear();
    await clearProvider('safeway');
    expect(preferencesSetMock).toHaveBeenCalledWith({
      key: PREF_KEY,
      value: JSON.stringify({}),
    });
  });

  it('SUBSCRIBE_NOTIFIES_ON_SET', async () => {
    const listener = vi.fn();
    subscribe(listener);
    await Promise.resolve();
    listener.mockClear();

    await setNeedsReconnect('costco');
    await Promise.resolve();

    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls.at(-1)?.[0]).toEqual({
      costco: expect.objectContaining({ kind: 'needs_reconnect' }),
    });
  });

  it('GET_ATTENTION_HYDRATES_FROM_PREFERENCES', async () => {
    preferencesGetMock.mockResolvedValue({
      value: JSON.stringify({
        safeway: { kind: 'needs_reconnect', updatedAt: 123 },
      }),
    });
    const items = await getAttention();
    expect(items).toEqual({
      safeway: { kind: 'needs_reconnect', updatedAt: 123 },
    });
  });

  it('CONCURRENT_SET_AND_CLEAR_PRESERVES_BOTH_PROVIDERS', async () => {
    const nowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(200);
    await Promise.all([setNeedsReconnect('safeway'), setNeedsReconnect('costco')]);
    const items = await getAttention();
    expect(items).toEqual({
      safeway: { kind: 'needs_reconnect', updatedAt: 100 },
      costco: { kind: 'needs_reconnect', updatedAt: 200 },
    });
    nowSpy.mockRestore();
  });
});
