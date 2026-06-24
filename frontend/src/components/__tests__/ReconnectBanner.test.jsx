import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ReconnectBanner, { classifyError } from '../ReconnectBanner';

describe('ReconnectBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('BANNER_HIDDEN_BY_DEFAULT', () => {
    render(
      <ReconnectBanner provider="safeway" storeName="Safeway" onReconnect={vi.fn()} />
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('BANNER_SHOWS_ON_NEEDS_RECONNECT_EVENT', () => {
    render(
      <ReconnectBanner provider="safeway" storeName="Safeway" onReconnect={vi.fn()} />
    );
    act(() => {
      window.dispatchEvent(new CustomEvent('safeway-sync-needs-reconnect'));
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reconnect Safeway/ })).toBeInTheDocument();
  });

  it('BANNER_SHOWS_ON_COSTCO_NEEDS_RECONNECT_EVENT', () => {
    render(
      <ReconnectBanner provider="costco" storeName="Costco" onReconnect={vi.fn()} />
    );
    act(() => {
      window.dispatchEvent(new CustomEvent('costco-sync-needs-reconnect'));
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reconnect Costco/ })).toBeInTheDocument();
  });

  it('BANNER_HIDES_ON_SYNC_COMPLETED_EVENT', () => {
    render(
      <ReconnectBanner
        provider="safeway"
        storeName="Safeway"
        onReconnect={vi.fn()}
        testForceVisible
      />
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new CustomEvent('safeway-sync-completed', { detail: {} }));
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('BANNER_HIDES_AFTER_DISMISS', () => {
    render(
      <ReconnectBanner
        provider="safeway"
        storeName="Safeway"
        onReconnect={vi.fn()}
        testForceVisible
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('BANNER_REAPPEARS_AFTER_DISMISS_ON_NEXT_NEEDS_RECONNECT', () => {
    render(
      <ReconnectBanner
        provider="safeway"
        storeName="Safeway"
        onReconnect={vi.fn()}
        testForceVisible
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new CustomEvent('safeway-sync-needs-reconnect'));
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('RECONNECT_BUTTON_CALLS_ON_RECONNECT', () => {
    const onReconnect = vi.fn();
    render(
      <ReconnectBanner
        provider="safeway"
        storeName="Safeway"
        onReconnect={onReconnect}
        testForceVisible
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Reconnect Safeway/ }));
    expect(onReconnect).toHaveBeenCalledOnce();
  });

  it('SYNC_ERROR_EXPIRED_PATTERN_SHOWS_BANNER', () => {
    render(
      <ReconnectBanner provider="safeway" storeName="Safeway" onReconnect={vi.fn()} />
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent('safeway-sync-error', { detail: { message: 'session expired' } })
      );
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('SYNC_ERROR_TRANSIENT_DOES_NOT_SHOW_BANNER', () => {
    render(
      <ReconnectBanner provider="safeway" storeName="Safeway" onReconnect={vi.fn()} />
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent('safeway-sync-error', { detail: { message: 'network timeout' } })
      );
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('SYNC_ERROR_UNKNOWN_DOES_NOT_SHOW_BANNER', () => {
    render(
      <ReconnectBanner provider="safeway" storeName="Safeway" onReconnect={vi.fn()} />
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent('safeway-sync-error', { detail: { message: 'something went wrong' } })
      );
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  describe('CLASSIFY_ERROR_EXPIRED_PATTERNS', () => {
    it.each([
      'session expired',
      'token invalid',
      'token expired',
      'credentials expired',
      '401',
      '403',
      'unauthorized',
      'forbidden',
    ])('classifies "%s" as expired', (message) => {
      expect(classifyError(message)).toBe('expired');
    });
  });

  describe('CLASSIFY_ERROR_TRANSIENT_PATTERNS', () => {
    it.each(['network error', 'timeout', 'fetch failed', 'connection refused', 'offline'])(
      'classifies "%s" as transient',
      (message) => {
        expect(classifyError(message)).toBe('transient');
      }
    );
  });

  it('DUPLICATE_NEEDS_RECONNECT_NO_FLASH', () => {
    const onReconnect = vi.fn();
    const { container } = render(
      <ReconnectBanner provider="safeway" storeName="Safeway" onReconnect={onReconnect} />
    );
    act(() => {
      window.dispatchEvent(new CustomEvent('safeway-sync-needs-reconnect'));
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    const htmlAfterFirst = container.innerHTML;
    act(() => {
      window.dispatchEvent(new CustomEvent('safeway-sync-needs-reconnect'));
    });
    expect(container.innerHTML).toBe(htmlAfterFirst);
    expect(onReconnect).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('BANNER_COPY_EXCLUDES_TECHNICAL_TERMS', () => {
    render(
      <ReconnectBanner
        provider="safeway"
        storeName="Safeway"
        onReconnect={vi.fn()}
        testForceVisible
      />
    );
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text).not.toMatch(/token|credential|session|cookie|401|403/i);
  });

  it('NO_CROSS_PROVIDER_INTERFERENCE', () => {
    render(
      <>
        <ReconnectBanner provider="safeway" storeName="Safeway" onReconnect={vi.fn()} />
        <ReconnectBanner provider="costco" storeName="Costco" onReconnect={vi.fn()} />
      </>
    );
    act(() => {
      window.dispatchEvent(new CustomEvent('costco-sync-needs-reconnect'));
    });
    expect(screen.getByRole('button', { name: /Reconnect Costco/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reconnect Safeway/ })).not.toBeInTheDocument();
  });

  it('LISTENERS_REMOVED_ON_UNMOUNT', () => {
    const { unmount } = render(
      <ReconnectBanner provider="safeway" storeName="Safeway" onReconnect={vi.fn()} />
    );
    unmount();
    expect(() => {
      act(() => {
        window.dispatchEvent(new CustomEvent('safeway-sync-needs-reconnect'));
      });
    }).not.toThrow();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
