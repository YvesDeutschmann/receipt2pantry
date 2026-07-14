import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { getAttentionMock, subscribeMock } = vi.hoisted(() => ({
  getAttentionMock: vi.fn(() => Promise.resolve({})),
  subscribeMock: vi.fn((listener) => {
    void getAttentionMock().then(listener);
    return () => {};
  }),
}));

vi.mock('../../services/providerAttentionStore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getAttention: (...args) => getAttentionMock(...args),
    subscribe: (...args) => subscribeMock(...args),
  };
});

import NeedsAttentionSection from '../NeedsAttentionSection';

function renderSection() {
  return render(
    <MemoryRouter>
      <NeedsAttentionSection />
    </MemoryRouter>
  );
}

describe('NeedsAttentionSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAttentionMock.mockResolvedValue({});
    subscribeMock.mockImplementation((listener) => {
      void getAttentionMock().then(listener);
      return () => {};
    });
  });

  it('HIDDEN_WHEN_EMPTY', async () => {
    renderSection();
    await Promise.resolve();
    expect(screen.queryByRole('heading', { name: /Needs attention/i })).not.toBeInTheDocument();
  });

  it('SHOWS_ROW_FOR_PERSISTED_RECONNECT', async () => {
    getAttentionMock.mockResolvedValue({
      safeway: { kind: 'needs_reconnect', updatedAt: 1 },
    });
    renderSection();
    expect(await screen.findByRole('heading', { name: /Needs attention/i })).toBeInTheDocument();
    expect(screen.getByText(/Safeway needs reconnect/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Reconnect/i })).toHaveAttribute('href', '/providers');
  });

  it('CLEARS_WHEN_STORE_CLEARED', async () => {
    getAttentionMock.mockResolvedValue({
      costco: { kind: 'needs_reconnect', updatedAt: 1 },
    });
    let listener;
    subscribeMock.mockImplementation((cb) => {
      listener = cb;
      cb({ costco: { kind: 'needs_reconnect', updatedAt: 1 } });
      return () => {};
    });
    renderSection();
    expect(await screen.findByText(/Costco needs reconnect/i)).toBeInTheDocument();
    await act(async () => {
      listener({});
    });
    expect(screen.queryByRole('heading', { name: /Needs attention/i })).not.toBeInTheDocument();
  });

  it('DISMISS_HIDES_FOR_SESSION_BUT_PREFERENCE_PERSISTS', async () => {
    getAttentionMock.mockResolvedValue({
      safeway: { kind: 'needs_reconnect', updatedAt: 1 },
    });
    const { unmount } = renderSection();
    expect(await screen.findByText(/Safeway needs reconnect/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Dismiss Safeway/i }));
    expect(screen.queryByText(/Safeway needs reconnect/i)).not.toBeInTheDocument();

    unmount();
    renderSection();
    expect(await screen.findByText(/Safeway needs reconnect/i)).toBeInTheDocument();
  });

  it('DISMISS_CLEARS_WHEN_UPDATED_AT_NEWER', async () => {
    let listener;
    subscribeMock.mockImplementation((cb) => {
      listener = cb;
      cb({ safeway: { kind: 'needs_reconnect', updatedAt: 100 } });
      return () => {};
    });
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(150);
    renderSection();
    expect(await screen.findByText(/Safeway needs reconnect/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Dismiss Safeway/i }));
    expect(screen.queryByText(/Safeway needs reconnect/i)).not.toBeInTheDocument();

    await act(async () => {
      listener({ safeway: { kind: 'needs_reconnect', updatedAt: 200 } });
    });
    expect(screen.getByText(/Safeway needs reconnect/i)).toBeInTheDocument();
    nowSpy.mockRestore();
  });

  it('CTA_NAVIGATES_TO_PROVIDERS', async () => {
    getAttentionMock.mockResolvedValue({
      safeway: { kind: 'needs_reconnect', updatedAt: 1 },
    });
    renderSection();
    expect(await screen.findByRole('link', { name: /Reconnect/i })).toHaveAttribute(
      'href',
      '/providers'
    );
  });
});
