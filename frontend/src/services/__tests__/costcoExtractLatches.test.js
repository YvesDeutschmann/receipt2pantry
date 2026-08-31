import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeTestJwt } from '../costcoMsalTokenHelpers.js';

function makeBrowserStorage() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

describe('costcoExtractScript page latches', () => {
  let posts;
  let prevMobile;

  beforeEach(() => {
    vi.useFakeTimers();
    posts = [];
    prevMobile = window.mobileApp;
    delete window.__costcoUnrecoverablePosted;
    delete window.__mealdTryPostTrace;
    delete window.__mealdTryPostTraceLast;
    delete window.__costcoDiagCount;
    delete window.__costcoPollActive;
    delete window.__costcoRtRefreshStarted;
    delete window.__costcoRtRefreshAttempts;
    delete window.__costcoS3ForceRefresh;
    vi.stubGlobal('location', {
      hostname: 'www.costco.com',
      href: 'https://www.costco.com/myaccount',
      hash: '',
    });
    vi.stubGlobal('localStorage', makeBrowserStorage());
    vi.stubGlobal('sessionStorage', makeBrowserStorage());
  });

  afterEach(() => {
    vi.useRealTimers();
    window.mobileApp = prevMobile;
    delete window.__costcoUnrecoverablePosted;
    delete window.__mealdTryPostTrace;
    delete window.__mealdTryPostTraceLast;
  });

  it('postSilentUnrecoverable does not latch without mobileApp', async () => {
    const ls = makeBrowserStorage();
    ls.setItem(
      'msal.id',
      JSON.stringify({
        credentialType: 'IdToken',
        environment: 'signin.costco.com',
        secret: makeTestJwt(-3600),
      })
    );
    ls.setItem(
      'msal.rt',
      JSON.stringify({
        credentialType: 'RefreshToken',
        environment: 'signin.costco.com',
        secret: 'revoked',
        clientId: 'client-abc',
      })
    );
    vi.stubGlobal('localStorage', ls);
    delete window.mobileApp;
    window.__costcoRtRefreshAttempts = 3;
    window.__costcoS3ForceRefresh = true;

    const { getExtractScript } = await import('../costcoExtractScript.js');
    // eslint-disable-next-line no-new-func
    new Function(getExtractScript('https://example.com/graphql'))();
    await vi.advanceTimersByTimeAsync(500);
    expect(window.__costcoUnrecoverablePosted).toBeFalsy();

    window.mobileApp = { postMessage: (m) => posts.push(m) };
    window.__costcoPollActive = false;
    window.__costcoRtRefreshAttempts = 3;
    // eslint-disable-next-line no-new-func
    new Function(getExtractScript('https://example.com/graphql'))();
    await vi.advanceTimersByTimeAsync(500);
    expect(window.__costcoUnrecoverablePosted).toBe(true);
    expect(posts.some((p) => p?.detail?.type === 'costco-silent-unrecoverable')).toBe(true);
  });

  it('traceTryPostBranch re-posts after a failed post', async () => {
    vi.stubGlobal('location', {
      hostname: 'signin.costco.com',
      href: 'https://signin.costco.com/',
      hash: '',
    });
    const { getExtractScript } = await import('../costcoExtractScript.js');
    window.__mealdTryPostTrace = 1;
    delete window.mobileApp;
    // eslint-disable-next-line no-new-func
    new Function(getExtractScript('https://example.com/graphql'))();
    await vi.advanceTimersByTimeAsync(21_000);
    expect(window.__mealdTryPostTraceLast).toBeUndefined();

    window.mobileApp = { postMessage: (m) => posts.push(m) };
    window.__costcoPollActive = false;
    // eslint-disable-next-line no-new-func
    new Function(getExtractScript('https://example.com/graphql'))();
    await vi.advanceTimersByTimeAsync(500);
    expect(
      posts.some(
        (p) =>
          p?.detail?.message === 'tryPost-branch' && p?.detail?.data?.branch === 'host_mismatch'
      )
    ).toBe(true);
    expect(window.__mealdTryPostTraceLast).toBe('host_mismatch');
  });
});
