import { describe, it, expect } from 'vitest';
import {
  findFreshIdToken,
  findFreshAccessToken,
  isJwtExpired,
  makeTestJwt,
} from '../services/costcoMsalTokenHelpers';

function mockStorage(entries) {
  const keys = Object.keys(entries);
  return {
    length: keys.length,
    key: (i) => keys[i] ?? null,
    getItem: (k) => entries[k] ?? null,
  };
}

function msalEntry(credentialType, secret) {
  return JSON.stringify({
    credentialType,
    environment: 'signin.costco.com',
    secret,
  });
}

describe('costcoMsalTokenHelpers', () => {
  it('findFreshIdToken skips expired and returns freshest non-expired secret', () => {
    const expired = makeTestJwt(-3600);
    const freshOlder = makeTestJwt(1800);
    const freshNewer = makeTestJwt(7200);
    const st = mockStorage({
      'msal.1': msalEntry('IdToken', expired),
      'msal.2': msalEntry('IdToken', freshOlder),
      'msal.3': msalEntry('IdToken', freshNewer),
    });
    expect(findFreshIdToken(st)).toBe(freshNewer);
    expect(isJwtExpired(expired)).toBe(true);
    expect(isJwtExpired(freshNewer)).toBe(false);
  });

  it('findFreshIdToken returns null when all IdTokens are expired', () => {
    const st = mockStorage({
      'msal.1': msalEntry('IdToken', makeTestJwt(-60)),
      'msal.2': msalEntry('IdToken', makeTestJwt(-120)),
    });
    expect(findFreshIdToken(st)).toBeNull();
  });

  it('findFreshAccessToken picks freshest AccessToken', () => {
    const st = mockStorage({
      a1: msalEntry('AccessToken', makeTestJwt(600)),
      a2: msalEntry('AccessToken', makeTestJwt(3600)),
    });
    expect(findFreshAccessToken(st)).toBe(makeTestJwt(3600));
  });

  it('getExtractScript embeds MSAL_CREDENTIAL_JS', async () => {
    const { getExtractScript } = await import('../services/costcoExtractScript.js');
    const { MSAL_CREDENTIAL_JS } = await import('../services/costcoMsalCredentialSource.js');
    expect(getExtractScript('https://example.com/graphql')).toContain(MSAL_CREDENTIAL_JS);
  });
});
