import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import SafewayConnectCard from '../SafewayConnectCard';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'ios',
    isNativePlatform: () => true,
  },
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
