import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  COSTCO_S3_RT_PLACEHOLDER,
  getSmashRefreshTokenScript,
} from '../costcoS3SmashScript.js';

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

function msalRt(secret) {
  return JSON.stringify({
    credentialType: 'RefreshToken',
    environment: 'signin.costco.com',
    secret,
    clientId: 'client-1',
  });
}

describe('costcoS3SmashScript', () => {
  let posts;
  let prevMobile;

  beforeEach(() => {
    posts = [];
    prevMobile = window.mobileApp;
    window.mobileApp = { postMessage: (m) => posts.push(m) };
    delete window.__costcoS3SmashNonce;
    delete window.__costcoS3SmashPostedNonce;
    delete window.__costcoS3ForceRefresh;
    vi.stubGlobal('location', {
      hostname: 'www.costco.com',
      href: 'https://www.costco.com/myaccount',
    });
  });

  afterEach(() => {
    window.mobileApp = prevMobile;
    delete window.__costcoS3ForceRefresh;
    delete window.__costcoS3SmashNonce;
    delete window.__costcoS3SmashPostedNonce;
    delete window.__mealdSyncNonce;
  });

  it('smashes RefreshToken in localStorage and sessionStorage', () => {
    const ls = makeBrowserStorage();
    const ss = makeBrowserStorage();
    ls.setItem('msal.rt', msalRt('real-rt'));
    ss.setItem('msal.rt.ss', msalRt('ss-rt'));
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('sessionStorage', ss);
    window.__mealdSyncNonce = 'nonce-a';

    // eslint-disable-next-line no-new-func
    new Function(getSmashRefreshTokenScript())();

    expect(JSON.parse(ls.getItem('msal.rt')).secret).toBe(COSTCO_S3_RT_PLACEHOLDER);
    expect(JSON.parse(ss.getItem('msal.rt.ss')).secret).toBe(COSTCO_S3_RT_PLACEHOLDER);
    expect(window.__costcoS3ForceRefresh).toBe(true);
  });

  it('posts smash checkpoint once per nonce with counts only', () => {
    const ls = makeBrowserStorage();
    ls.setItem('msal.rt', msalRt('real-rt'));
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('sessionStorage', makeBrowserStorage());

    const script = getSmashRefreshTokenScript();
    window.__mealdSyncNonce = 'nonce-a';
    // eslint-disable-next-line no-new-func
    new Function(script)();
    // eslint-disable-next-line no-new-func
    new Function(script)();

    let checkpoints = posts.filter(
      (p) => p?.detail?.data?.checkpoint === 's3-smash-rt'
    );
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].detail.data.smashed).toBe(1);
    expect(checkpoints[0].detail.data.lsLen).toBe(1);
    expect(checkpoints[0].detail.data.nonce).toBe('nonce-a');
    expect(JSON.stringify(checkpoints[0])).not.toContain('real-rt');

    window.__mealdSyncNonce = 'nonce-b';
    // eslint-disable-next-line no-new-func
    new Function(script)();
    checkpoints = posts.filter((p) => p?.detail?.data?.checkpoint === 's3-smash-rt');
    expect(checkpoints).toHaveLength(2);
  });

  it('ignores non-costco host', () => {
    vi.stubGlobal('location', { hostname: 'signin.costco.com', href: 'https://signin.costco.com/' });
    const ls = makeBrowserStorage();
    ls.setItem('msal.rt', msalRt('real-rt'));
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('sessionStorage', makeBrowserStorage());
    window.__mealdSyncNonce = 'nonce-a';

    // eslint-disable-next-line no-new-func
    new Function(getSmashRefreshTokenScript())();

    expect(JSON.parse(ls.getItem('msal.rt')).secret).toBe('real-rt');
    expect(window.__costcoS3ForceRefresh).toBeUndefined();
  });

  it('clears refresh and unrecoverable latches once per nonce', () => {
    const ls = makeBrowserStorage();
    ls.setItem('msal.rt', msalRt('real-rt'));
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('sessionStorage', makeBrowserStorage());
    window.__mealdSyncNonce = 'nonce-a';
    window.__costcoRtRefreshStarted = true;
    window.__costcoUnrecoverablePosted = true;

    // eslint-disable-next-line no-new-func
    new Function(getSmashRefreshTokenScript())();

    expect(window.__costcoRtRefreshStarted).toBe(false);
    expect(window.__costcoUnrecoverablePosted).toBe(false);
  });

  it('retries smash checkpoint when mobileApp is missing', () => {
    const ls = makeBrowserStorage();
    ls.setItem('msal.rt', msalRt('real-rt'));
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('sessionStorage', makeBrowserStorage());
    window.__mealdSyncNonce = 'nonce-a';
    delete window.mobileApp;

    const script = getSmashRefreshTokenScript();
    // eslint-disable-next-line no-new-func
    new Function(script)();
    expect(posts.filter((p) => p?.detail?.data?.checkpoint === 's3-smash-rt')).toHaveLength(0);

    window.mobileApp = { postMessage: (m) => posts.push(m) };
    // eslint-disable-next-line no-new-func
    new Function(script)();
    expect(posts.filter((p) => p?.detail?.data?.checkpoint === 's3-smash-rt')).toHaveLength(1);
  });
});
