/**
 * Costco Token Extraction - Injected into WebView via preShowScript
 * Runs inside the Costco domain context. Polls localStorage for MSAL tokens
 * and sends them to the native app via window.mobileApp.postMessage.
 *
 * MSAL stores: idToken, clientID, and RefreshToken in credential cache keys.
 */

(function () {
  'use strict';

  const POLL_INTERVAL_MS = 500;
  const MAX_POLL_TIME_MS = 5 * 60 * 1000; // 5 minutes

  function findMSALRefreshToken() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes('RefreshToken')) {
          try {
            const value = JSON.parse(localStorage.getItem(key));
            if (value && value.secret) {
              return {
                refreshToken: value.secret,
                refreshTokenClientId: value.clientId || null
              };
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
    return { refreshToken: null, refreshTokenClientId: null };
  }

  function extractAkamaiCookies(cookieStr) {
    const cookies = {};
    if (!cookieStr) return cookies;
    cookieStr.split(';').forEach(function (part) {
      const [name, ...rest] = part.trim().split('=');
      const key = (name || '').trim();
      if (key === 'ak_bmsc' || key === 'bm_sv') {
        cookies[key] = (rest.join('=') || '').trim();
      }
    });
    return cookies;
  }

  function postTokens() {
    const idToken = localStorage.getItem('idToken');
    if (!idToken) return false;

    const clientID = localStorage.getItem('clientID') || localStorage.getItem('clientId') || null;
    const { refreshToken, refreshTokenClientId } = findMSALRefreshToken();

    const cookieStr = typeof document !== 'undefined' ? document.cookie : '';
    const payload = {
      type: 'costco-tokens',
      idToken,
      clientID,
      refreshToken,
      refreshTokenClientId,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      cookies: cookieStr,
      akamaiCookies: extractAkamaiCookies(cookieStr)
    };

    try {
      if (typeof window !== 'undefined' && window.mobileApp && typeof window.mobileApp.postMessage === 'function') {
        window.mobileApp.postMessage({ detail: payload });
        return true;
      }
    } catch (_) {}
    return false;
  }

  const startTime = Date.now();
  const poll = setInterval(function () {
    if (postTokens()) {
      clearInterval(poll);
      return;
    }
    if (Date.now() - startTime >= MAX_POLL_TIME_MS) {
      clearInterval(poll);
    }
  }, POLL_INTERVAL_MS);
})();
