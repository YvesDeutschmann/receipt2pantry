/**
 * Generic WebView bridge factory for grocery provider token extraction and receipt fetch.
 * Extracts shared InAppBrowser lifecycle, message handling, and token storage.
 */

import { Capacitor } from '@capacitor/core';
import { InAppBrowser, ToolBarType } from '@capgo/inappbrowser';

const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_SILENT_TIMEOUT_MS = 45_000;
const DEFAULT_EXTRACT_INTERVAL_MS = 3000;

const BRIDGE_LOG_MSG_MAX = 2000;

function getDevLogUrl() {
  try {
    const envBase = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE_URL) || null;
    const hostname = (typeof window !== 'undefined' && window.location && window.location.hostname) || 'localhost';
    const base = String(envBase || `http://${hostname}:5000/api`).replace(/\/+$/, '');
    return `${base}/dev/log`;
  } catch {
    return 'http://localhost:5000/api/dev/log';
  }
}

/**
 * POST debug lines to the dev backend from the main Capacitor WebView (no retailer CSP).
 * Body format matches /api/dev/log: TAG|message (text/plain).
 */
function bridgeDevLog(tag, msg) {
  try {
    const safeTag = String(tag || 'WebViewBridge').replace(/\s+/g, '_').slice(0, 64);
    let safeMsg = String(msg ?? '');
    if (safeMsg.length > BRIDGE_LOG_MSG_MAX) safeMsg = safeMsg.slice(0, BRIDGE_LOG_MSG_MAX) + '…';
    fetch(getDevLogUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: `${safeTag}|${safeMsg}`,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

/**
 * Normalize messageFromWebview payloads. iOS Capgo casts message.body as [String: Any];
 * stringified JSON arrives as event.rawMessage instead of event.detail.
 */
function parseWebViewMessageEvent(event) {
  let d = event?.detail;
  if (!d && typeof event?.rawMessage === 'string') {
    try {
      const parsed = JSON.parse(event.rawMessage);
      d = parsed?.detail ?? parsed;
    } catch {
      /* ignore */
    }
  }
  return d;
}

/**
 * Close the WebView. Retries up to 3 times with 300ms delay.
 */
async function closeWebView(logPrefix) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await InAppBrowser.close();
      console.log(`${logPrefix} WebView closed (attempt ${attempt})`);
      return;
    } catch (err) {
      console.warn(`${logPrefix} close attempt ${attempt} failed:`, err?.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 300));
    }
  }
}

/**
 * Create a WebView bridge for a grocery provider.
 *
 * @param {Object} config
 * @param {string} config.provider - Provider name (e.g. 'costco', 'safeway')
 * @param {string} config.loginUrl - URL to open for login
 * @param {string} config.homeUrl - URL for silent sync
 * @param {string[]} config.extractDomains - Domains where extraction runs
 * @param {() => string} config.getExtractScript - Returns IIFE script string
 * @param {{ receipts: string, tokens: string, debug?: string }} config.messageTypes
 * @param {Object} config.tokenStorage - createTokenStorage() instance
 * @param {(d: any) => Object} config.extractTokensFromReceiptsMessage - Maps receipts message to storage values
 * @param {(d: any) => Object} config.extractTokensFromTokensMessage - Maps tokens message to storage values
 * @param {(d: any) => any[]} config.extractRawReceipts - Extracts raw receipts array from message
 * @param {(raw: any[]) => any[]} config.parseReceipts - Parses raw receipts to backend format
 * @param {(raw: any[]) => any[]} [config.filterReceipts] - Optional pre-parse filter
 * @param {number} [config.loginTimeoutMs]
 * @param {number} [config.silentTimeoutMs]
 * @param {number} [config.extractIntervalMs]
 * @param {string} [config.loginTitle] - WebView title for login
 * @param {string} [config.urlExcludePattern] - URL pattern to exclude from extraction trigger (e.g. '/LogonForm')
 * @param {string[]} [config.skipInjectionUrlPatterns] - Substrings when present in WebView URL skip executeScript extraction (Costco login: signin/Azure/B2C)
 * @param {Object} [config.httpOnlyCookies] - Optional HttpOnly cookie extraction: { url, cookieName, parseToken, injectKey, injectVarName }
 * @param {() => string} [config.preExtractVars] - Optional JS snippet to inject before extract script (e.g. window.__knownOrderIds=...)
 * @param {() => Promise<string|undefined>} [config.extractCookiesBeforeClose] - Optional: read cookies from InAppBrowser before close (e.g. for native API Cookie header)
 */
export function createWebViewBridge(config) {
  const {
    provider,
    loginUrl,
    homeUrl,
    extractDomains,
    getExtractScript,
    messageTypes,
    tokenStorage,
    extractTokensFromReceiptsMessage,
    extractTokensFromTokensMessage,
    extractRawReceipts,
    parseReceipts,
    filterReceipts,
    loginTimeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
    silentTimeoutMs = DEFAULT_SILENT_TIMEOUT_MS,
    extractIntervalMs = DEFAULT_EXTRACT_INTERVAL_MS,
    loginTitle = `Sign in to ${provider}`,
    urlExcludePattern = '',
    skipInjectionUrlPatterns = [],
    httpOnlyCookies,
    preExtractVars,
    extractCookiesBeforeClose,
  } = config;

  const LOG_PREFIX = `[${provider}WebViewBridge]`;
  const EXTRACT_SCRIPT = getExtractScript();

  const isExtractUrl = (url) => {
    if (!url) return false;
    if (urlExcludePattern && url.includes(urlExcludePattern)) return false;
    return extractDomains.some((d) => url.includes(d));
  };

  const shouldSkipInjectionForUrl = (url) => {
    if (!url || !skipInjectionUrlPatterns.length) return false;
    return skipInjectionUrlPatterns.some((p) => url.includes(p));
  };

  /** For logging Akamai/https diagnostics (blocked URLs still report https in practice). */
  const logUrlScheme = (prefix, url) => {
    if (!url) return;
    const isHttps = url.startsWith('https:');
    const schemeHint = isHttps ? 'https' : url.startsWith('http:') ? 'http' : 'other';
    console.log(`${LOG_PREFIX} ${prefix} (${schemeHint}), len=${url.length}`);
  };

  const handleReceiptsMessage = async (d, finish) => {
    const rawReceipts = extractRawReceipts(d) ?? [];
    const filtered = filterReceipts ? filterReceipts(rawReceipts) : rawReceipts;
    const receipts = parseReceipts(Array.isArray(filtered) ? filtered : []).filter(Boolean);
    const tokens = extractTokensFromReceiptsMessage(d);

    await closeWebView(LOG_PREFIX);
    await tokenStorage.store(tokens);

    finish({
      ...tokens,
      receipts,
      _fromWebView: true,
    });
  };

  const handleTokensMessage = async (d, finish) => {
    const tokens = extractTokensFromTokensMessage(d);
    let cookieHeader;
    if (extractCookiesBeforeClose) {
      cookieHeader = await extractCookiesBeforeClose().catch(() => undefined);
    }
    await closeWebView(LOG_PREFIX);
    await tokenStorage.store(tokens);
    finish({
      ...tokens,
      _closeWebViewAfterFetch: true,
      cookieHeader,
    });
  };

  return {
    async startLogin() {
      console.log(`${LOG_PREFIX} startLogin() called, platform=${Capacitor.getPlatform()}`);
      if (!Capacitor.isNativePlatform()) {
        throw new Error(`${provider} WebView bridge requires a native platform (iOS/Android)`);
      }
      await InAppBrowser.close().catch(() => {});

      let messageListener;
      let closeListener;
      let urlListener;
      let tokensReceived = false;
      let progressReceived = false;
      let extractInterval;
      let timeoutHandle;
      let pendingGraceTimer = null;
      const finish = { resolve: null, reject: null };

      let extractionAttempts = 0;
      let httpOnlyTokenInjected = false;
      /** Last URL from urlChangeEvent (diagnostics / bridge logging only). */
      let lastBrowserUrl = loginUrl;
      const loginLogTag = `${provider}Login`;

      const runHttpOnlyCookiePoll = async () => {
        if (!httpOnlyCookies || tokensReceived || httpOnlyTokenInjected) return;
        try {
          const cookies = await InAppBrowser.getCookies({
            url: httpOnlyCookies.url,
            includeHttpOnly: true,
          });
          const raw = cookies?.[httpOnlyCookies.cookieName];
          if (!raw) return;
          const parsed = httpOnlyCookies.parseToken(raw);
          if (!parsed) return;
          const tokenValue = parsed[httpOnlyCookies.injectKey];
          if (!tokenValue) return;
          const escaped = JSON.stringify(tokenValue);
          const code = `window.${httpOnlyCookies.injectVarName}=${escaped};`;
          await InAppBrowser.executeScript({ code });
          httpOnlyTokenInjected = true;
          console.log(`${LOG_PREFIX} Injected HttpOnly token (${httpOnlyCookies.injectVarName})`);
        } catch (err) {
          console.warn(`${LOG_PREFIX} getCookies failed:`, err?.message || err);
        }
      };

      const runExtraction = () => {
        if (tokensReceived) return;
        if (shouldSkipInjectionForUrl(lastBrowserUrl)) {
          return;
        }
        extractionAttempts++;
        runHttpOnlyCookiePoll().then(async () => {
          if (preExtractVars) {
            await InAppBrowser.executeScript({ code: preExtractVars() }).catch(() => {});
          }
          InAppBrowser.executeScript({ code: EXTRACT_SCRIPT }).catch((err) => {
            const em = err?.message || String(err);
            if (extractionAttempts <= 3 || extractionAttempts % 10 === 0) {
              console.warn(`${LOG_PREFIX} executeScript failed (attempt ${extractionAttempts}):`, em);
              bridgeDevLog(loginLogTag, `executeScript failed attempt=${extractionAttempts} lastUrl=${(lastBrowserUrl || '').slice(0, 160)} err=${em.slice(0, 200)}`);
            }
          });
        });
      };

      const cleanup = () => {
        messageListener?.remove?.();
        closeListener?.remove?.();
        urlListener?.remove?.();
        if (pendingGraceTimer != null) {
          clearTimeout(pendingGraceTimer);
          pendingGraceTimer = null;
        }
        if (extractInterval != null) {
          clearInterval(extractInterval);
          extractInterval = null;
        }
        if (timeoutHandle != null) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      };

      try {
        messageListener = await InAppBrowser.addListener('messageFromWebview', (event) => {
          try {
            const d = parseWebViewMessageEvent(event);
            if (d?.type === messageTypes.debug) {
              console.log(`${LOG_PREFIX} [WebView] ${d.message || ''}`, d.data ?? '');
              try {
                const payload = `${d.message || ''} ${JSON.stringify(d.data ?? {})}`;
                bridgeDevLog(loginLogTag, `webview debug: ${payload}`);
              } catch {
                bridgeDevLog(loginLogTag, `webview debug: ${d.message || ''}`);
              }
              return;
            }
            if (messageTypes.progress && d?.type === messageTypes.progress) {
              progressReceived = true;
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('webview-progress', { detail: d }));
              }
              return;
            }
            if (messageTypes.receipts && d?.type === messageTypes.receipts) {
              if (tokensReceived) return;
              tokensReceived = true;
              console.log(`${LOG_PREFIX} Receipts message received (attempt ${extractionAttempts})`);
              cleanup();
              handleReceiptsMessage(d, (result) => finish.resolve?.(result)).catch((err) => {
                console.error(`${LOG_PREFIX} receipts handler error`, err?.message || err);
                const raw = extractRawReceipts(d) ?? [];
                const filtered = filterReceipts ? filterReceipts(raw) : raw;
                tokenStorage.store(extractTokensFromReceiptsMessage(d)).then(() => {
                  finish.resolve?.({ ...extractTokensFromReceiptsMessage(d), receipts: parseReceipts(Array.isArray(filtered) ? filtered : []).filter(Boolean), _fromWebView: true });
                });
              });
              return;
            }
            if (d?.type === messageTypes.tokens && extractTokensFromTokensMessage(d)) {
              if (tokensReceived) return;
              tokensReceived = true;
              console.log(`${LOG_PREFIX} Tokens message received (attempt ${extractionAttempts})`);
              cleanup();
              handleTokensMessage(d, (result) => finish.resolve?.(result)).catch((err) => {
                console.error(`${LOG_PREFIX} tokens handler error`, err?.message || err);
                tokenStorage.store(extractTokensFromTokensMessage(d)).then(() => {
                  finish.resolve?.({ ...extractTokensFromTokensMessage(d), _closeWebViewAfterFetch: true });
                });
              });
            }
          } catch (err) {
            console.error(`${LOG_PREFIX} messageFromWebview handler error`, err?.message || err);
          }
        });

        closeListener = await InAppBrowser.addListener('closeEvent', () => {
          if (tokensReceived) return;
          if (progressReceived) {
            bridgeDevLog(loginLogTag, `closeEvent: progress seen; grace 3s lastUrl=${(lastBrowserUrl || '').slice(0, 160)}`);
            // Fetch in progress — could be a foreign WebView closing; wait for receipts
            pendingGraceTimer = setTimeout(() => {
              if (tokensReceived) return;
              bridgeDevLog(loginLogTag, 'closeEvent: grace timeout → reject sync incomplete');
              cleanup();
              finish.reject?.(new Error('WebView closed before sync completed'));
            }, 3000);
            return;
          }
          // No progress seen — user closed early
          bridgeDevLog(loginLogTag, `closeEvent: user closed before tokens lastUrl=${(lastBrowserUrl || '').slice(0, 160)}`);
          console.warn(`${LOG_PREFIX} closeEvent - WebView closed before tokens extracted`);
          cleanup();
          finish.reject?.(new Error('WebView closed before tokens were extracted'));
        });

        urlListener = await InAppBrowser.addListener('urlChangeEvent', (ev) => {
          const u = ev?.url || '';
          lastBrowserUrl = u;
          logUrlScheme('urlChange', u);
          bridgeDevLog(
            loginLogTag,
            `urlChange: ${u.slice(0, 200)} isExtract=${isExtractUrl(u)} skipInjection=${shouldSkipInjectionForUrl(u)} tokensReceived=${tokensReceived}`
          );
          console.log(
            `${LOG_PREFIX} urlChange: ${u.slice(0, 180)}, tokensReceived=${tokensReceived}, isExtract=${isExtractUrl(u)}, skipInjection=${shouldSkipInjectionForUrl(u)}`
          );
          if (httpOnlyCookies) httpOnlyTokenInjected = false;
          if (tokensReceived) return;
          if (isExtractUrl(u) && !shouldSkipInjectionForUrl(u)) {
            runExtraction();
            setTimeout(runExtraction, 800);
            setTimeout(runExtraction, 2500);
          }
        });
      } catch (listenerErr) {
        console.error(`${LOG_PREFIX} Failed to register listeners`, listenerErr);
        throw listenerErr;
      }

      return new Promise((resolve, reject) => {
        finish.resolve = resolve;
        finish.reject = reject;
        extractInterval = setInterval(runExtraction, extractIntervalMs);

        timeoutHandle = setTimeout(() => {
          if (tokensReceived) return;
          bridgeDevLog(
            loginLogTag,
            `login timeout ${loginTimeoutMs / 1000}s lastUrl=${(lastBrowserUrl || '').slice(0, 160)}`
          );
          console.warn(`${LOG_PREFIX} Login timeout (${loginTimeoutMs / 1000}s)`);
          cleanup();
          InAppBrowser.close().catch(() => {});
          finish.reject?.(new Error(`${provider} login timed out. Please try again and complete sign-in within 5 minutes.`));
        }, loginTimeoutMs);

        bridgeDevLog(loginLogTag, `startLogin opening url=${loginUrl.slice(0, 200)}`);
        InAppBrowser.openWebView({
          url: loginUrl,
          title: loginTitle,
          toolbarType: ToolBarType.NAVIGATION,
          isPresentAfterPageLoad: false, // true causes blank screen on Android 13+ when URL redirects (safeway.com)
          isInspectable: true,
        })
          .then(() => {
            bridgeDevLog(loginLogTag, 'startLogin WebView opened');
            console.log(`${LOG_PREFIX} WebView opened`);
          })
          .catch((err) => {
            bridgeDevLog(loginLogTag, `openWebView failed: ${(err?.message || err || '').toString().slice(0, 300)}`);
            console.error(`${LOG_PREFIX} openWebView failed`, err);
            cleanup();
            reject(err);
          });
      });
    },

    async closeWebViewAfterFetch() {
      return closeWebView(LOG_PREFIX);
    },

    async startSilentSync() {
      console.log(`${LOG_PREFIX} startSilentSync() called`);
      if (!Capacitor.isNativePlatform()) return null;

      return new Promise((resolve) => {
        let received = false;
        let messageListener;
        let urlListener;
        let silentExtractInterval;
        let silentHttpOnlyInjected = false;
        /** Last URL from urlChangeEvent (diagnostics / bridge logging only). */
        let silentLastUrl = '';
        const silentLogTag = `${provider}Silent`;

        const runSilentHttpOnlyPoll = async () => {
          if (!httpOnlyCookies || received || silentHttpOnlyInjected) return;
          try {
            const cookies = await InAppBrowser.getCookies({
              url: httpOnlyCookies.url,
              includeHttpOnly: true,
            });
            const raw = cookies?.[httpOnlyCookies.cookieName];
            if (!raw) return;
            const parsed = httpOnlyCookies.parseToken(raw);
            if (!parsed) return;
            const tokenValue = parsed[httpOnlyCookies.injectKey];
            if (!tokenValue) return;
            const escaped = JSON.stringify(tokenValue);
            const code = `window.${httpOnlyCookies.injectVarName}=${escaped};`;
            await InAppBrowser.executeScript({ code });
            silentHttpOnlyInjected = true;
            console.log(`${LOG_PREFIX} [silent] Injected HttpOnly token (${httpOnlyCookies.injectVarName})`);
          } catch (err) {
            console.warn(`${LOG_PREFIX} [silent] getCookies failed:`, err?.message || err);
          }
        };

        let silentExtractionAttempts = 0;
        const runSilentExtraction = () => {
          if (received) return;
          silentExtractionAttempts++;
          runSilentHttpOnlyPoll().then(async () => {
            if (preExtractVars) {
              await InAppBrowser.executeScript({ code: preExtractVars() }).catch(() => {});
            }
            InAppBrowser.executeScript({ code: EXTRACT_SCRIPT }).catch((err) => {
              const em = err?.message || String(err);
              if (silentExtractionAttempts <= 3 || silentExtractionAttempts % 10 === 0) {
                bridgeDevLog(
                  silentLogTag,
                  `executeScript failed attempt=${silentExtractionAttempts} lastUrl=${(silentLastUrl || '').slice(0, 160)} err=${em.slice(0, 200)}`
                );
              }
            });
          });
        };

        const timeout = setTimeout(() => {
          if (received) return;
          bridgeDevLog(
            silentLogTag,
            `silent timeout ${silentTimeoutMs / 1000}s lastUrl=${(silentLastUrl || '').slice(0, 160)}`
          );
          console.log(`${LOG_PREFIX} startSilentSync: ${silentTimeoutMs / 1000}s timeout`);
          if (silentExtractInterval) clearInterval(silentExtractInterval);
          messageListener?.remove?.();
          urlListener?.remove?.();
          InAppBrowser.close().catch(() => {});
          resolve(null);
        }, silentTimeoutMs);

        const finish = (result) => {
          if (received) return;
          received = true;
          clearTimeout(timeout);
          if (silentExtractInterval) clearInterval(silentExtractInterval);
          messageListener?.remove?.();
          urlListener?.remove?.();
          InAppBrowser.close().catch(() => {});
          resolve(result);
        };

        (async () => {
          try {
            messageListener = await InAppBrowser.addListener('messageFromWebview', (event) => {
              const d = parseWebViewMessageEvent(event);
              if (d?.type === messageTypes.debug) {
                console.log(`${LOG_PREFIX} [silent] ${d.message || ''}`, d.data ?? '');
                try {
                  const payload = `${d.message || ''} ${JSON.stringify(d.data ?? {})}`;
                  bridgeDevLog(silentLogTag, `webview debug: ${payload}`);
                } catch {
                  bridgeDevLog(silentLogTag, `webview debug: ${d.message || ''}`);
                }
                return;
              }
              if (messageTypes.progress && d?.type === messageTypes.progress) {
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('webview-progress', { detail: d }));
                }
                return;
              }
              if (messageTypes.receipts && d?.type === messageTypes.receipts) {
                if (received) return;
                const rawReceipts = extractRawReceipts(d) ?? [];
                const filtered = filterReceipts ? filterReceipts(rawReceipts) : rawReceipts;
                const receipts = parseReceipts(filtered).filter(Boolean);
                const tokens = extractTokensFromReceiptsMessage(d);
                closeWebView(LOG_PREFIX).then(() =>
                  tokenStorage.store(tokens)
                ).then(() => {
                  finish({ ...tokens, receipts, _fromWebView: true });
                }).catch((err) => {
                  console.error(`${LOG_PREFIX} startSilentSync receipts handler error`, err?.message || err);
                  tokenStorage.store(tokens).then(() => finish({ ...tokens, receipts, _fromWebView: true }));
                });
                return;
              }
              if (d?.type === messageTypes.tokens) {
                if (received) return;
                const tokens = extractTokensFromTokensMessage(d);
                (async () => {
                  let cookieHeader;
                  if (extractCookiesBeforeClose) {
                    cookieHeader = await extractCookiesBeforeClose().catch(() => undefined);
                  }
                  await closeWebView(LOG_PREFIX);
                  await tokenStorage.store(tokens);
                  finish({ ...tokens, _closeWebViewAfterFetch: true, cookieHeader });
                })().catch((err) => {
                  console.error(`${LOG_PREFIX} startSilentSync tokens handler error`, err?.message || err);
                  tokenStorage.store(tokens).then(() =>
                    finish({ ...tokens, _closeWebViewAfterFetch: true })
                  );
                });
              }
            });

            urlListener = await InAppBrowser.addListener('urlChangeEvent', (ev) => {
              if (received) return;
              const u = ev?.url || '';
              silentLastUrl = u;
              bridgeDevLog(silentLogTag, `urlChange: ${u.slice(0, 200)} isExtract=${isExtractUrl(u)}`);
              silentHttpOnlyInjected = false;
              runSilentExtraction();
              setTimeout(runSilentExtraction, 800);
              setTimeout(runSilentExtraction, 2500);
            });

            bridgeDevLog(silentLogTag, `startSilentSync opening url=${homeUrl.slice(0, 200)}`);
            await InAppBrowser.openWebView({
              url: homeUrl,
              isPresentAfterPageLoad: true, // delay until load so hidden sync can close before user sees WebView
              width: 1,
              height: 1,
              x: -9999,
              y: -9999,
              isInspectable: true,
            });
            silentLastUrl = homeUrl;
            bridgeDevLog(silentLogTag, 'startSilentSync WebView opened');
            // Always start interval — script injection was previously done by preShowScript;
            // now done exclusively via executeScript
            runSilentExtraction();
            silentExtractInterval = setInterval(runSilentExtraction, extractIntervalMs);
          } catch (err) {
            bridgeDevLog(silentLogTag, `startSilentSync failed: ${(err?.message || err || '').toString().slice(0, 300)}`);
            console.error(`${LOG_PREFIX} startSilentSync failed`, err);
            clearTimeout(timeout);
            messageListener?.remove?.();
            urlListener?.remove?.();
            resolve(null);
          }
        })();
      });
    },

    async storeTokens(values) {
      return tokenStorage.store(values);
    },

    async getStoredTokens() {
      return tokenStorage.get();
    },

    async hasStoredTokens() {
      return tokenStorage.has();
    },

    async clearStoredTokens() {
      await tokenStorage.clear();
      console.log(`${LOG_PREFIX} clearStoredTokens: cleared`);
    },
  };
}
