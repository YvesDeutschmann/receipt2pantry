import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import SafewayConnectCard from '../SafewayConnectCard';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'ios',
    isNativePlatform: () => true,
  },
}));

const { subscribeHealthMock } = vi.hoisted(() => ({
  subscribeHealthMock: vi.fn((listener) => {
    listener({});
    return () => {};
  }),
}));

vi.mock('../../services/syncHealthStore', () => ({
  subscribeHealth: (...args) => subscribeHealthMock(...args),
}));

vi.mock('../../hooks/useSafewaySync', () => ({
  useSafewaySync: vi.fn(),
  STATUS: {
    IDLE: 'idle',
    AUTHENTICATING: 'authenticating',
    FETCHING: 'fetching',
    SUBMITTING: 'submitting',
    SUCCESS: 'success',
    ERROR: 'error',
    SKIPPED: 'skipped',
  },
}));

import { useSafewaySync, STATUS } from '../../hooks/useSafewaySync';

describe('SafewayConnectCard', () => {
  const startSync = vi.fn();

  const defaultHookReturn = {
    status: STATUS.IDLE,
    error: null,
    result: null,
    progress: null,
    startSync,
    startSilent: vi.fn(),
    hasStoredTokens: false,
    checkStoredTokens: vi.fn(),
    isNative: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSafewaySync).mockReturnValue({ ...defaultHookReturn });
    subscribeHealthMock.mockImplementation((listener) => {
      listener({});
      return () => {};
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('RECONNECT_BANNER_MOUNTED_IN_SAFEWAY_CARD', () => {
    render(<SafewayConnectCard userId="test-user-id" />);
    act(() => {
      window.dispatchEvent(new CustomEvent('safeway-sync-needs-reconnect'));
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reconnect Safeway/ })).toBeInTheDocument();
  });

  it('RECONNECT_BANNER_CALLS_START_SYNC_IN_SAFEWAY_CARD', () => {
    render(<SafewayConnectCard userId="test-user-id" />);
    act(() => {
      window.dispatchEvent(new CustomEvent('safeway-sync-needs-reconnect'));
    });
    fireEvent.click(screen.getByRole('button', { name: /Reconnect Safeway/ }));
    expect(startSync).toHaveBeenCalledOnce();
  });

  it('HIDES_HEALTH_WHEN_NO_RECORD', () => {
    render(<SafewayConnectCard userId="test-user-id" />);
    expect(screen.queryByText(/Last synced/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sync in progress/i)).not.toBeInTheDocument();
  });

  it('RENDERS_NO_NEW_RECEIPTS_ON_COMPLETED_EMPTY', () => {
    subscribeHealthMock.mockImplementation((listener) => {
      listener({
        safeway: {
          lastAttemptAt: Date.now() - 60_000,
          lastOutcome: 'completed_empty',
          lastCompletedAt: Date.now() - 60_000,
          receiptsStored: 0,
          lastToastedOutcome: null,
        },
      });
      return () => {};
    });
    render(<SafewayConnectCard userId="test-user-id" />);
    expect(screen.getByText(/No new receipts · Last synced/i)).toBeInTheDocument();
  });

  it('RENDERS_LAST_SYNC_AT_WHEN_HEALTH_PRESENT', () => {
    subscribeHealthMock.mockImplementation((listener) => {
      listener({
        safeway: {
          lastAttemptAt: Date.now() - 120_000,
          lastOutcome: 'completed_items',
          lastCompletedAt: Date.now() - 120_000,
          receiptsStored: 3,
          lastToastedOutcome: null,
        },
      });
      return () => {};
    });
    render(<SafewayConnectCard userId="test-user-id" />);
    expect(screen.getByText(/Synced 3 receipts · Last synced/i)).toBeInTheDocument();
  });

  it('RENDERS_SYNC_IN_PROGRESS_ON_SKIPPED_STATUS', () => {
    vi.mocked(useSafewaySync).mockReturnValue({
      ...defaultHookReturn,
      status: STATUS.SKIPPED,
    });
    render(<SafewayConnectCard userId="test-user-id" />);
    expect(screen.getByText('Sync in progress')).toBeInTheDocument();
  });

  it('RECONNECT_BANNER_HIDES_AFTER_SYNC_COMPLETED', () => {
    render(<SafewayConnectCard userId="test-user-id" />);
    act(() => {
      window.dispatchEvent(new CustomEvent('safeway-sync-needs-reconnect'));
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('safeway-sync-completed', {
          detail: { tier: 'manual', receipts_stored: 1, items_added: 0 },
        })
      );
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
