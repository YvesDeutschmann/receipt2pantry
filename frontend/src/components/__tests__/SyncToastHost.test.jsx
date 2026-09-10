import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import SyncToastHost from '../SyncToastHost';
import {
  recordTerminalOutcome,
  __resetHealthStoreForTests,
} from '../../services/syncHealthStore';
import { setSyncUserId, __resetSyncPrefKeysForTests } from '../../services/syncPrefKeys';

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

const USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('SyncToastHost', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    __resetSyncPrefKeysForTests();
    __resetHealthStoreForTests();
    setSyncUserId(USER_ID);
    preferencesGetMock.mockResolvedValue({ value: null });
    preferencesSetMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('TOAST_ON_ITEMS_ADDED', () => {
    render(<SyncToastHost />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent('costco-sync-completed', {
          detail: { tier: 'silent', receipts_stored: 1, items_added: 3 },
        })
      );
    });
    expect(screen.getByRole('status')).toHaveTextContent('Added 3 items from Costco');
  });

  it('NO_TOAST_WHEN_ITEMS_ZERO', () => {
    render(<SyncToastHost />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent('safeway-sync-completed', {
          detail: { tier: 'silent', receipts_stored: 0, items_added: 0 },
        })
      );
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('TOAST_ON_NEEDS_RECONNECT', async () => {
    render(<SyncToastHost />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('safeway-sync-needs-reconnect'));
      await Promise.resolve();
    });
    expect(screen.getByRole('status')).toHaveTextContent('Safeway needs reconnect');
  });

  it('TOAST_ON_TRANSIENT_ERROR', async () => {
    render(<SyncToastHost />);
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('costco-sync-error', { detail: { message: 'network timeout' } })
      );
      await Promise.resolve();
    });
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't refresh Costco");
  });

  it('NO_REPEAT_TOAST_ON_SAME_OUTCOME', async () => {
    render(<SyncToastHost />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('safeway-sync-needs-reconnect'));
      await Promise.resolve();
      window.dispatchEvent(new CustomEvent('safeway-sync-needs-reconnect'));
      await Promise.resolve();
    });
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('NO_REPEAT_TOAST_AFTER_REMOUNT', async () => {
    await recordTerminalOutcome('safeway', { outcome: 'failed' });

    const { unmount } = render(<SyncToastHost />);
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('safeway-sync-error', {
          detail: { outcome: 'failed', reason: 'network' },
        })
      );
      await Promise.resolve();
    });
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't refresh Safeway");

    unmount();
    render(<SyncToastHost />);
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('safeway-sync-error', {
          detail: { outcome: 'failed', reason: 'network' },
        })
      );
      await Promise.resolve();
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('NO_TOAST_OUTSIDE_APPSHELL', () => {
    render(<div data-testid="without-host" />);
    act(() => {
      window.dispatchEvent(new CustomEvent('safeway-sync-needs-reconnect'));
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
