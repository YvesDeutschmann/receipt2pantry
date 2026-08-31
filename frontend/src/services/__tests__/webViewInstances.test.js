import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ibState, InAppBrowser } = vi.hoisted(() => {
  const state = { closeListeners: [] };
  const InAppBrowser = {
    addListener: vi.fn(async (event, cb) => {
      if (event === 'closeEvent') state.closeListeners.push(cb);
      return { remove: vi.fn() };
    }),
    close: vi.fn(() => Promise.resolve()),
  };
  return { ibState: state, InAppBrowser };
});

vi.mock('@capgo/inappbrowser', () => ({ InAppBrowser }));

vi.mock('../syncEventLog.js', () => ({
  logPhase: vi.fn(() => Promise.resolve()),
  SyncPhase: { WEBVIEW_ORPHAN_CLOSED: 'webview_orphan_closed' },
}));

import {
  claimIfNew,
  snapshotIds,
  noteId,
  reapKnownUnowned,
  _resetWebViewInstancesForTests,
  getSessionInstanceId,
} from '../webViewInstances.js';

describe('webViewInstances', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ibState.closeListeners = [];
    _resetWebViewInstancesForTests();
  });

  it('claimIfNew rejects ids present in pre-open snapshot', () => {
    noteId('old-wv');
    const snap = snapshotIds();
    expect(claimIfNew(1, 'old-wv', snap)).toBe(false);
    expect(claimIfNew(1, 'new-wv', snap)).toBe(true);
    expect(getSessionInstanceId(1)).toBe('new-wv');
  });

  it('reapKnownUnowned closes unowned ids', async () => {
    noteId('orphan-1');
    const n = await reapKnownUnowned('pre_session', 'costco', 'silent');
    expect(n).toBe(1);
    expect(InAppBrowser.close).toHaveBeenCalledWith({ id: 'orphan-1' });
  });
});
