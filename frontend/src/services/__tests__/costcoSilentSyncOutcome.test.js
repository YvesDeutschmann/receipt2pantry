import { describe, it, expect } from 'vitest';
import {
  classifyCostcoSilentResult,
  isCostcoSilentSuccess,
  isTerminalCostcoSessionReason,
  isTerminalSilentReconnectResult,
  isTransientCostcoFailure,
} from '../costcoSilentSyncOutcome.js';

describe('costcoSilentSyncOutcome', () => {
  it('classifies null as timeout', () => {
    expect(classifyCostcoSilentResult(null)).toBe('timeout');
  });

  it('classifies skipped', () => {
    expect(classifyCostcoSilentResult({ _skipped: true })).toBe('skipped');
  });

  it('classifies needs_reconnect', () => {
    expect(classifyCostcoSilentResult({ needs_reconnect: true, reason: 'refresh_invalid_grant' })).toBe(
      'needs_reconnect'
    );
  });

  it('classifies tokens_only', () => {
    expect(classifyCostcoSilentResult({ idToken: 'x', _tokensOnly: true })).toBe('tokens_only');
  });

  it('does not treat needs_reconnect object as synced', () => {
    const result = { needs_reconnect: true, receipts: [] };
    expect(classifyCostcoSilentResult(result)).toBe('needs_reconnect');
    expect(isCostcoSilentSuccess(result)).toBe(false);
  });

  it('treats receipt payload as synced success only with receipts', () => {
    const ok = { receipts: [{ order_id: '1' }], idToken: 'tok' };
    expect(classifyCostcoSilentResult(ok)).toBe('synced');
    expect(isCostcoSilentSuccess(ok)).toBe(true);
    expect(isCostcoSilentSuccess({ receipts: [] })).toBe(false);
  });

  it('isTerminalCostcoSessionReason detects invalid_grant family', () => {
    expect(isTerminalCostcoSessionReason('refresh_invalid_grant')).toBe(true);
    expect(isTerminalCostcoSessionReason('silent_timeout')).toBe(false);
  });

  it('isTerminalSilentReconnectResult requires terminal reason', () => {
    expect(
      isTerminalSilentReconnectResult({ needs_reconnect: true, reason: 'refresh_invalid_grant' })
    ).toBe(true);
    expect(isTerminalSilentReconnectResult({ needs_reconnect: true, reason: 'refresh_network' })).toBe(
      false
    );
  });

  it('isTransientCostcoFailure treats Network Error as transient', () => {
    expect(isTransientCostcoFailure(new Error('Network Error'))).toBe(true);
  });

  it('isTransientCostcoFailure treats invalid_grant as non-transient', () => {
    const err = new Error('Token refresh failed: invalid_grant');
    err.code = 'invalid_grant';
    expect(isTransientCostcoFailure(err)).toBe(false);
  });

  it('isTransientCostcoFailure treats Meald 401 as transient for token preservation', () => {
    expect(isTransientCostcoFailure({ message: 'Unauthorized', status: 401 })).toBe(true);
  });
});
