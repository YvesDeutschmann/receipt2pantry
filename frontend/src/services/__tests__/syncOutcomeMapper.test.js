import { describe, it, expect } from 'vitest';
import {
  mapCostcoSilentToOutcome,
  mapSafewaySilentToOutcome,
  SYNC_OUTCOMES,
} from '../syncOutcomeMapper';

describe('syncOutcomeMapper', () => {
  it('COSTCO_EMPTY_FROM_WEBVIEW_IS_COMPLETED_EMPTY', () => {
    expect(mapCostcoSilentToOutcome({ receipts: [], _fromWebView: true })).toEqual({
      outcome: SYNC_OUTCOMES.COMPLETED_EMPTY,
      receipts: [],
    });
  });

  it('COSTCO_EMPTY_WITHOUT_FROM_WEBVIEW_IS_FAILED', () => {
    expect(mapCostcoSilentToOutcome({ receipts: [] })).toEqual({
      outcome: SYNC_OUTCOMES.FAILED,
      receipts: [],
      reason: 'fetch_incomplete',
    });
  });

  it('COSTCO_TOKENS_ONLY_IS_FAILED', () => {
    expect(mapCostcoSilentToOutcome({ idToken: 'x', _tokensOnly: true })).toEqual({
      outcome: SYNC_OUTCOMES.FAILED,
      receipts: [],
      reason: 'tokens_only',
    });
  });

  it('COSTCO_NULL_IS_FAILED_TIMEOUT', () => {
    expect(mapCostcoSilentToOutcome(null)).toEqual({
      outcome: SYNC_OUTCOMES.FAILED,
      receipts: [],
      reason: 'silent_timeout',
    });
  });

  it('COSTCO_SKIPPED_PASSTHROUGH', () => {
    expect(mapCostcoSilentToOutcome({ _skipped: true, reason: 'webview_busy' })).toEqual({
      outcome: SYNC_OUTCOMES.SKIPPED,
      receipts: [],
      reason: 'webview_busy',
    });
  });

  it('SAFEWAY_PARSE_ALL_DROPPED_IS_FAILED', () => {
    expect(
      mapSafewaySilentToOutcome(
        { accessToken: 'tok', clubCard: '123' },
        { rawCount: 3, parsedCount: 0, fetchCompleted: true }
      )
    ).toEqual({
      outcome: SYNC_OUTCOMES.FAILED,
      reason: 'parse_all_dropped',
    });
  });

  it('SAFEWAY_FETCH_RETURNED_EMPTY_IS_COMPLETED_EMPTY', () => {
    expect(
      mapSafewaySilentToOutcome(
        { accessToken: 'tok', clubCard: '123' },
        { rawCount: 0, parsedCount: 0, fetchCompleted: true }
      )
    ).toEqual({
      outcome: SYNC_OUTCOMES.COMPLETED_EMPTY,
    });
  });

  it('SAFEWAY_FETCH_NOT_COMPLETED_IS_FAILED', () => {
    expect(
      mapSafewaySilentToOutcome(
        { accessToken: 'tok', clubCard: '123' },
        { rawCount: 0, parsedCount: 0, fetchCompleted: false }
      )
    ).toEqual({
      outcome: SYNC_OUTCOMES.FAILED,
      reason: 'fetch_incomplete',
    });
  });
});
