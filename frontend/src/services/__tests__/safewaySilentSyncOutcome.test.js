import { describe, it, expect } from 'vitest';
import {
  classifySafewaySilentResult,
  isSafewaySilentExtractSuccess,
} from '../safewaySilentSyncOutcome.js';

describe('safewaySilentSyncOutcome', () => {
  it('classifies null as timeout', () => {
    expect(classifySafewaySilentResult(null)).toBe('timeout');
  });

  it('classifies skipped', () => {
    expect(classifySafewaySilentResult({ _skipped: true })).toBe('skipped');
  });

  it('classifies needs_reconnect', () => {
    expect(
      classifySafewaySilentResult({ needs_reconnect: true, reason: 'missing_session_cookie' })
    ).toBe('needs_reconnect');
  });

  it('classifies missing accessToken as needs_reconnect', () => {
    expect(classifySafewaySilentResult({ clubCard: '123' })).toBe('needs_reconnect');
  });

  it('classifies missing clubCard as error not reconnect', () => {
    expect(classifySafewaySilentResult({ accessToken: 'tok' })).toBe('error');
  });

  it('classifies token payload as synced', () => {
    const ok = { accessToken: 'tok', clubCard: '999' };
    expect(classifySafewaySilentResult(ok)).toBe('synced');
    expect(isSafewaySilentExtractSuccess(ok)).toBe(true);
  });
});
