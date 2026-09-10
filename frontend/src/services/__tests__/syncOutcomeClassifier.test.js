import { describe, it, expect } from 'vitest';
import { classifySyncFailure } from '../syncOutcomeClassifier';

describe('syncOutcomeClassifier', () => {
  it('CLASSIFIER_IGNORES_DIGITS_IN_MESSAGE_BODY', () => {
    expect(classifySyncFailure({ message: 'order 401123' })).not.toBe('expired');
  });

  it('CLASSIFIER_STATUS_401_IS_EXPIRED', () => {
    expect(classifySyncFailure({ status: 401 })).toBe('expired');
  });

  it('CLASSIFIER_ALLOWLISTED_REASON_IS_EXPIRED', () => {
    expect(classifySyncFailure({ reason: 'invalid_grant' })).toBe('expired');
  });
});
