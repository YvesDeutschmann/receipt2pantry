# Costco one-tap sync — diagnostics (WebView login)

Manual checks and follow-ups referenced by the Costco InAppBrowser flow.

## Current model (post–Option A, 2026-05)

**No preemptive session wipe.** Costco `startLogin()` opens the InAppBrowser without calling `clearAllCookies` / `clearCache` first, and `[webViewBridge.js](../frontend/src/services/webViewBridge.js)` no longer injects an Akamai/MSAL localStorage wipe on navigation.

We previously patched `@capgo/inappbrowser` so `clearAllCookies` wiped **all** website data (including main-app WebView storage) and paired it with a JS wipe — that caused MSAL token loss and Supabase session loss. Both the patch script and the JS wipe were **removed**. `cap:patch` now only runs `[patch-capacitor-proguard.js](../frontend/scripts/patch-capacitor-proguard.js)`.

**On-demand recovery:** `[clearCostcoInAppBrowserSession()](../frontend/src/services/costcoWebViewBridge.js)` still closes the browser and calls upstream `clearAllCookies` + `clearCache` when `[useCostcoSync.js](../frontend/src/hooks/useCostcoSync.js)` hits token-class errors (401/403/expired/etc.). That is the intentional escape hatch if Akamai or stale B2C state blocks a retry.

**Supabase:** Auth session uses Capacitor `[Preferences](../frontend/src/services/supabaseClient.js)` on native so incidental cookie clears do not log the user out of the main app.

## Re-confirm healthy logs after rebuild

Watch for these `dev_log` entries (proxied via `/api/dev/log`) after `npm run cap:run:ios` or Android on a **physical device**:

1. `[costcoLogin] startLogin opening url=https://www.costco.com`
2. After `OAuthLogonCmd` / `www.costco.com`: `tryPost-tick` and eventually `msal-tokens-found` from the injected extract script.
3. `[costcoLogin] urlChange: .../ordersandpurchases` with `tokensReceived=true` or a `costco-tokens` / `costco-receipts` message.

If `page-diagnostic.title === "Access Denied"` appears: capture `page-diagnostic.lsKeys` and UA; try **one** manual Costco sync retry after a successful forced error path that invokes `clearCostcoInAppBrowserSession()`. If it persists on device but works in Safari/Chrome, treat as bot scoring (see H3 below).

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

Web search alone does **not** surface a public Costco-specific deprecation notice for `B2C_1A_SSO_WCS_signupsignin_201`. Treat policy drift as plausible only **after** on-demand `clearCostcoInAppBrowserSession()` / reinstall and H2/H5 overlays are ruled out via logs.

If sign-in still fails:

- Inspect the SSO URL Costco uses today in Safari (address bar / redirect chain) and compare `B2C_1A_SSO_`* policy segment (`signupsignin_201` vs newer variants).
- If Costco rolled a new user flow tenant-wide, capture redirects + response headers and compare to the WebView; do not blindly patch policy IDs in our app URLs.

## H3 follow-up engineering options

If UA / bot scoring is confirmed:

1. `**WKWebView`** (iOS): append a benign fragment via `WKWebViewConfiguration` / `customUserAgent` (requires native config or Capacitor plugin).
2. **System browser OAuth**: swap InAppBrowser `openWebView` for OAuth step to `@capgo/inappbrowser` `open()` + documented `pantryapp://` return (see `[capacitor.config.ts](../frontend/capacitor.config.ts)`).
3. **Upstream** a `userAgent` option if `@capgo/inappbrowser` adds one.

## Manual QA checklist (Android + iOS real devices)

Run after `npm run build:mobile` and installing the build:

**Android**

1. Fresh install → sign in → complete onboarding → Costco one-tap; confirm receipts ingest and user stays signed in.
2. Force-close app → reopen → still signed in.
3. Induce a token-class failure (or wait for expiry) → confirm retry path clears InAppBrowser session via `clearCostcoInAppBrowserSession` and a second login succeeds.

**iOS**

1. Same as Android steps 1–2 on a physical device (not Simulator for Costco/Akamai).
2. In backend `dev_log`, confirm `tryPost-tick` and `msal-tokens-found` after `OAuthLogonCmd` when login succeeds.

**Regression**

- Safeway one-tap and silent sync still work.
- Onboarding `complete()` succeeds without `Auth session missing`.