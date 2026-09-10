import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const {
  setNeedsReconnectMock,
  setFetchFailedMock,
  clearProviderMock,
  recordTerminalOutcomeMock,
} = vi.hoisted(() => ({
  setNeedsReconnectMock: vi.fn(() => Promise.resolve()),
  setFetchFailedMock: vi.fn(() => Promise.resolve()),
  clearProviderMock: vi.fn(() => Promise.resolve()),
  recordTerminalOutcomeMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../services/providerAttentionStore', () => ({
  setNeedsReconnect: (...args) => setNeedsReconnectMock(...args),
  setFetchFailed: (...args) => setFetchFailedMock(...args),
  clearProvider: (...args) => clearProviderMock(...args),
}));

vi.mock('../../services/syncHealthStore', () => ({
  recordTerminalOutcome: (...args) => recordTerminalOutcomeMock(...args),
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
      window.dispatchEvent(
        new CustomEvent('safeway-sync-completed', {
          detail: { outcome: 'completed_items' },
        })
      );
      await Promise.resolve();
    });
    expect(clearProviderMock).toHaveBeenCalledWith('safeway');
  });

  it('EMPTY_UNVERIFIED_RESULT_DOES_NOT_CLEAR_RECONNECT', async () => {
    renderHook(() => useProviderAttentionSync());
    await act(async () => {
      window.dispatchEvent(new CustomEvent('safeway-sync-completed', { detail: {} }));
      await Promise.resolve();
    });
    expect(clearProviderMock).not.toHaveBeenCalled();
  });

  it('COMPLETED_EMPTY_CLEARS_RECONNECT', async () => {
    renderHook(() => useProviderAttentionSync());
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('safeway-sync-completed', {
          detail: { outcome: 'completed_empty' },
        })
      );
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

  it('TRANSIENT_ERROR_SETS_FETCH_FAILED', async () => {
    renderHook(() => useProviderAttentionSync());
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('safeway-sync-error', { detail: { message: 'network timeout' } })
      );
      await Promise.resolve();
    });
    expect(setFetchFailedMock).toHaveBeenCalledWith('safeway');
    expect(setNeedsReconnectMock).not.toHaveBeenCalled();
    expect(clearProviderMock).not.toHaveBeenCalled();
    expect(recordTerminalOutcomeMock).toHaveBeenCalledWith('safeway', { outcome: 'failed' });
  });

  it('FAILED_OUTCOME_SETS_FETCH_FAILED', async () => {
    renderHook(() => useProviderAttentionSync());
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('costco-sync-error', {
          detail: { outcome: 'failed', reason: 'fetch_incomplete' },
        })
      );
      await Promise.resolve();
    });
    expect(setFetchFailedMock).toHaveBeenCalledWith('costco');
    expect(recordTerminalOutcomeMock).toHaveBeenCalledWith('costco', { outcome: 'failed' });
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
