import { describe, it, expect } from 'vitest';
import {
  findFreshIdToken,
  findFreshAccessToken,
  findRT,
  findRTWithKey,
  findExpiredIdToken,
  findAnySigninIdToken,
  findSigninIdTokenForEndpointAny,
  b2cAuthorityFromEntry,
  isJwtExpired,
  jwtClaim,
  jwtSecondsLeft,
  makeTestJwt,
  credentialCensus,
} from '../services/costcoMsalTokenHelpers';
import { COSTCO_S3_RT_PLACEHOLDER } from '../services/costcoS3SmashScript.js';

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

  it('credentialCensus returns zeros for empty storage', () => {
    const st = mockStorage({});
    const c = credentialCensus(st);
    expect(c.seen).toBe(0);
    expect(c.hasUsableRt).toBe(false);
    expect(c.environments).toBe('');
  });

  it('credentialCensus counts wrong-environment entries without signin.costco.com match', () => {
    const st = mockStorage({
      bad: JSON.stringify({
        credentialType: 'IdToken',
        environment: 'other.example.com',
        secret: makeTestJwt(3600),
      }),
    });
    const c = credentialCensus(st);
    expect(c.seen).toBe(1);
    expect(c.environments).toBe('other.example.com');
    expect(c.expired).toBe(0);
  });

  it('credentialCensus marks expired IdToken and usable RefreshToken', () => {
    const st = mockStorage({
      id: msalEntry('IdToken', makeTestJwt(-120)),
      rt: msalEntry('RefreshToken', 'refresh-secret-value'),
    });
    const c = credentialCensus(st);
    expect(c.seen).toBe(2);
    expect(c.idTokens).toBe(1);
    expect(c.refreshTokens).toBe(1);
    expect(c.expired).toBe(1);
    expect(c.hasUsableRt).toBe(true);
    expect(c.environments).toBe('signin.costco.com');
  });

  it('credentialCensus counts unparseable secrets', () => {
    const st = mockStorage({
      bad: msalEntry('IdToken', 'not-a-jwt'),
    });
    const c = credentialCensus(st);
    expect(c.unparseable).toBe(1);
  });

  it('findExpiredIdToken skips unparseable IdToken; findSigninIdTokenForEndpointAny skips garbage', () => {
    const st = mockStorage({
      bad: msalEntry('IdToken', 'not-a-jwt'),
    });
    expect(findExpiredIdToken(st)).toBeNull();
    expect(findAnySigninIdToken(st)).toBe('not-a-jwt');
    expect(findSigninIdTokenForEndpointAny()).toBeNull();
  });

  it('b2cAuthorityFromEntry parses homeAccountId', () => {
    const auth = b2cAuthorityFromEntry({
      homeAccountId:
        'oid-b2c_1a_sso_wcs_signup_signin_209.e0714dd4-784d-46d6-a278-3e29553483eb',
      realm: 'e0714dd4-784d-46d6-a278-3e29553483eb',
    });
    expect(auth.tenant).toBe('e0714dd4-784d-46d6-a278-3e29553483eb');
    expect(auth.policy).toBe('b2c_1a_sso_wcs_signup_signin_209');
  });

  it('credentialCensus counts entries with no secret', () => {
    const st = mockStorage({
      empty: JSON.stringify({
        credentialType: 'AccessToken',
        environment: 'signin.costco.com',
      }),
    });
    const c = credentialCensus(st);
    expect(c.noSecret).toBe(1);
  });

  it('jwtClaim reads tfp from JWT payload', () => {
    const header = btoa(JSON.stringify({ alg: 'none' }));
    const payload = btoa(JSON.stringify({ tfp: 'B2C_1A_test', exp: 9999999999 }));
    const jwt = `${header}.${payload}.sig`;
    expect(jwtClaim(jwt, 'tfp')).toBe('B2C_1A_test');
    expect(jwtClaim(jwt, 'acr')).toBeNull();
    expect(jwtSecondsLeft(jwt, 60)).toBeGreaterThan(0);
  });

  it('findRT skips revoked placeholder unless S3 force-refresh', () => {
    const st = mockStorage({
      smashed: msalEntry('RefreshToken', COSTCO_S3_RT_PLACEHOLDER),
      fresh: msalEntry('RefreshToken', 'live-rt-secret'),
    });
    expect(findRT(st).rt).toBe('live-rt-secret');
    window.__costcoS3ForceRefresh = true;
    expect(findRT(st).rt).toBe(COSTCO_S3_RT_PLACEHOLDER);
    delete window.__costcoS3ForceRefresh;
  });

  it('findRTWithKey skips revoked without force-refresh', () => {
    const st = mockStorage({
      only: msalEntry('RefreshToken', COSTCO_S3_RT_PLACEHOLDER),
    });
    expect(findRTWithKey(st).rt).toBeNull();
    window.__costcoS3ForceRefresh = true;
    expect(findRTWithKey(st).rt).toBe(COSTCO_S3_RT_PLACEHOLDER);
    delete window.__costcoS3ForceRefresh;
  });

  it('credentialCensus does not count revoked RT as usable', () => {
    const st = mockStorage({
      rt: msalEntry('RefreshToken', COSTCO_S3_RT_PLACEHOLDER),
    });
    expect(credentialCensus(st).hasUsableRt).toBe(false);
    window.__costcoS3ForceRefresh = true;
    expect(credentialCensus(st).hasUsableRt).toBe(true);
    delete window.__costcoS3ForceRefresh;
  });
});
