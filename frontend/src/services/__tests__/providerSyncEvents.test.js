import { describe, it, expect, vi } from 'vitest';
import {
  dispatchProviderSyncCompleted,
  dispatchProviderSyncFailed,
} from '../providerSyncEvents';

describe('providerSyncEvents', () => {
  it('dispatchProviderSyncCompleted emits safeway-sync-completed with detail', () => {
    const listener = vi.fn();
    window.addEventListener('safeway-sync-completed', listener);

    dispatchProviderSyncCompleted('safeway', {
      tier: 'manual',
      receipts_stored: 2,
      items_added: 5,
      outcome: 'completed_items',
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail).toEqual({
      tier: 'manual',
      receipts_stored: 2,
      items_added: 5,
      outcome: 'completed_items',
    });

    window.removeEventListener('safeway-sync-completed', listener);
  });

  it('dispatchProviderSyncCompleted emits costco-sync-completed with detail', () => {
    const listener = vi.fn();
    window.addEventListener('costco-sync-completed', listener);

    dispatchProviderSyncCompleted('costco', {
      tier: 'silent',
      receipts_stored: 0,
      items_added: 0,
      outcome: 'completed_empty',
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].type).toBe('costco-sync-completed');
    expect(listener.mock.calls[0][0].detail).toEqual({
      tier: 'silent',
      receipts_stored: 0,
      items_added: 0,
      outcome: 'completed_empty',
    });

    window.removeEventListener('costco-sync-completed', listener);
  });

  it('dispatchProviderSyncFailed emits *-sync-error with outcome failed', () => {
    const listener = vi.fn();
    window.addEventListener('costco-sync-error', listener);

    dispatchProviderSyncFailed('costco', { reason: 'fetch_incomplete', message: 'Could not load' });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail).toEqual({
      reason: 'fetch_incomplete',
      message: 'Could not load',
      outcome: 'failed',
    });

    window.removeEventListener('costco-sync-error', listener);
  });
});
