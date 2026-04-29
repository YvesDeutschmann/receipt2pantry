# Costco one-tap sync — diagnostics (WebView login)

Manual checks and follow-ups referenced by the Costco InAppBrowser hardening plan.

Session reset on Costco login uses `InAppBrowser.clearAllCookies` + `clearCache` ([`costcoWebViewBridge.js`](../frontend/src/services/costcoWebViewBridge.js)) — but **the upstream `@capgo/inappbrowser` only clears `WKWebsiteDataTypeCookies` on iOS and `CookieManager` on Android**, leaving `localStorage` / `sessionStorage` / `IndexedDB` intact. That allows Akamai Bot Manager telemetry (`ak_a`, `ak_ax`, `_abck`, `bm_*`) to survive across attempts and produce a 403 on retry.

To fix this we apply two layers:

1. **Native plugin patch** ([`scripts/patch-capgo-inappbrowser.js`](../frontend/scripts/patch-capgo-inappbrowser.js)) — extends iOS `clearAllCookies`/`clearCache` to use `WKWebsiteDataStore.allWebsiteDataTypes()` and Android `clearCache`/`clearAllCookies` to also call `WebStorage.deleteAllData()` + `removeSessionCookies`. Wired into `postinstall` and the `cap:*` npm scripts via the `cap:patch` alias.
2. **In-WebView storage wipe** ([`webViewBridge.js`](../frontend/src/services/webViewBridge.js) → `wipeAkamaiAndMsalStorageOnce`) — once per host on extract-domain navigation, deletes the known Akamai keys, MSAL B2C entries, and any IndexedDB databases. Belt-and-suspenders in case the plugin upstream API drifts again.

> **A native rebuild is required** after pulling these changes: `cd frontend && npm run cap:sync && npx cap run ios` (or `android`). The patch lives in `node_modules/`; without rebuild + native sync the binary on the device is unaffected.

See also programmatic `clearCostcoInAppBrowserSession()` exported from the bridge (used after token errors in [`useCostcoSync.js`](../frontend/src/hooks/useCostcoSync.js)).

## Re-confirm fix after rebuild

Watch for these `dev_log` entries (proxied via `/api/dev/log`) after pulling these changes and running `npm run cap:run:ios`:

1. `[costcoLogin] startLogin opening url=https://www.costco.com`
2. `[costcoLogin] urlChange: https://www.costco.com/ ...` — followed by a fresh `page-diagnostic` whose `lsKeys` should **not** contain `ak_a` or `ak_ax` after the first reset; if they do, our `wipeAkamaiAndMsalStorageOnce` JS will wipe them on the next tick.
3. `[costcoLogin] urlChange: https://signin.costco.com/.../authorize?...` — `page-diagnostic` for that host should also have a clean `lsKeys` set on the very first attempt; on retry it must look identical to the first attempt (no `Access Denied` title).

If `page-diagnostic.title === "Access Denied"` reappears: capture `page-diagnostic.lsKeys` immediately before the failure to see which Akamai/MSAL key survived, and add it to the `KEYS` array in [`webViewBridge.js`](../frontend/src/services/webViewBridge.js) `wipeAkamaiAndMsalStorageOnce`.

## H3 — Compare with mobile Safari / Chrome on the same device

1. On **the same physical device**, open Safari (iOS) or Chrome (Android) and browse to `https://www.costco.com`.
2. Complete sign-in (password or email OTP).
3. If login **succeeds** in Safari/Chrome but **fails only** in Meald's InAppBrowser **after** a clean slate (cookies cleared via app reinstall or developer build with session clear):

   **Interpretation:** Costco's edge (Akamai) may be scoring the WebView UA / TLS fingerprint as automated traffic.

4. Capture the UA from app logs (`page-diagnostic.ua` in `[costcoWebViewBridge] [WebView] page-diagnostic` lines) vs Safari (“Request Desktop Website” off): note `Version/`, `wv` (Android WebView marker), etc.

## H5 — Confirm HTTPS in `urlChangeEvent`

Production logs emit two lines per navigation:

- `urlChange (https)` or `http`/`other`
- Full `urlChange:` line with truncated URL

Akamai block pages often display `http://` in HTML even when navigation was HTTPS. Use these logs—not the CDN error HTML—as the source of truth.

## H6 — Policy string changes (fallback investigation)

Web search alone does **not** surface a public Costco-specific deprecation notice for `B2C_1A_SSO_WCS_signupsignin_201`. Treat policy drift as plausible only **after** H1 stale-state clearing and H2/H5 overlays are ruled out via logs.

If sign-in still fails:

- Inspect the SSO URL Costco uses today in Safari (address bar / redirect chain) and compare `B2C_1A_SSO_*` policy segment (`signupsignin_201` vs newer variants).
- If Costco rolled a new user flow tenant-wide, capture redirects + response headers and compare to the WebView; do not blindly patch policy IDs in our app URLs.

## H3 follow-up engineering options

If UA / bot scoring is confirmed:

1. **`WKWebView`** (iOS): append a benign fragment via `WKWebViewConfiguration` / `customUserAgent` (requires native config or Capacitor plugin).
2. **System browser OAuth**: swap InAppBrowser `openWebView` for OAuth step to `@capgo/inappbrowser` `open()` + documented `pantryapp://` return (see [`capacitor.config.ts`](../frontend/capacitor.config.ts)).
3. **Upstream** a `userAgent` option if `@capgo/inappbrowser` adds one.
