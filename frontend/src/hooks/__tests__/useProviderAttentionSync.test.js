import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const {
  setNeedsReconnectMock,
  clearProviderMock,
} = vi.hoisted(() => ({
  setNeedsReconnectMock: vi.fn(() => Promise.resolve()),
  clearProviderMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../services/providerAttentionStore', () => ({
  setNeedsReconnect: (...args) => setNeedsReconnectMock(...args),
  clearProvider: (...args) => clearProviderMock(...args),
}));

import { useProviderAttentionSync } from '../useProviderAttentionSync';

describe('useProviderAttentionSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SET_ON_NEEDS_RECONNECT_EVENT', async () => {
    renderHook(() => useProviderAttentionSync());
    await act(async () => {
      window.dispatchEvent(new CustomEvent('safeway-sync-needs-reconnect'));
      await Promise.resolve();
    });
    expect(setNeedsReconnectMock).toHaveBeenCalledWith('safeway');
  });

  it('CLEAR_ON_COMPLETED_EVENT', async () => {
    renderHook(() => useProviderAttentionSync());
    await act(async () => {
      window.dispatchEvent(new CustomEvent('safeway-sync-completed', { detail: {} }));
      await Promise.resolve();
    });
    expect(clearProviderMock).toHaveBeenCalledWith('safeway');
  });

  it('EXPIRED_ERROR_SETS_ATTENTION', async () => {
    renderHook(() => useProviderAttentionSync());
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('safeway-sync-error', { detail: { message: '401 unauthorized' } })
      );
      await Promise.resolve();
    });
    expect(setNeedsReconnectMock).toHaveBeenCalledWith('safeway');
  });

  it('TRANSIENT_ERROR_DOES_NOT', async () => {
    renderHook(() => useProviderAttentionSync());
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('safeway-sync-error', { detail: { message: 'network timeout' } })
      );
      await Promise.resolve();
    });
    expect(setNeedsReconnectMock).not.toHaveBeenCalled();
    expect(clearProviderMock).not.toHaveBeenCalled();
  });

  it('ATTENTION_LISTENER_MOUNTED_AT_APPROUTES', async () => {
    renderHook(() => useProviderAttentionSync());
    await act(async () => {
      window.dispatchEvent(new CustomEvent('costco-sync-needs-reconnect'));
      await Promise.resolve();
    });
    expect(setNeedsReconnectMock).toHaveBeenCalledWith('costco');
  });
});
