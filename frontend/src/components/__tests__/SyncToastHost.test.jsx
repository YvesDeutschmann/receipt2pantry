import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import SyncToastHost from '../SyncToastHost';

describe('SyncToastHost', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
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

  it('TOAST_ON_NEEDS_RECONNECT', () => {
    render(<SyncToastHost />);
    act(() => {
      window.dispatchEvent(new CustomEvent('safeway-sync-needs-reconnect'));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Safeway needs reconnect');
  });

  it('TOAST_ON_TRANSIENT_ERROR', () => {
    render(<SyncToastHost />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent('costco-sync-error', { detail: { message: 'network timeout' } })
      );
    });
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't refresh Costco");
  });

  it('NO_REPEAT_TOAST_ON_SAME_OUTCOME', () => {
    render(<SyncToastHost />);
    act(() => {
      window.dispatchEvent(new CustomEvent('safeway-sync-needs-reconnect'));
      window.dispatchEvent(new CustomEvent('safeway-sync-needs-reconnect'));
    });
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('NO_TOAST_OUTSIDE_APPSHELL', () => {
    render(<div data-testid="without-host" />);
    act(() => {
      window.dispatchEvent(new CustomEvent('safeway-sync-needs-reconnect'));
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
