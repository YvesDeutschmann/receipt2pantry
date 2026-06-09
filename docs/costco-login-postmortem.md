# Costco One-Tap Login — Post-Mortem & Debugging Guide

**Status: RESOLVED (2026-06-09).** Verified working on physical Android + iPad (TestFlight).

This is the canonical reference for the Costco WebView login / receipt-sync failures.
Read this **first** before re-debugging Costco login. It records what broke, every
hypothesis we chased (and ruled out), and the actual fixes — so we never re-litigate this.

Related: [costco-onetap-architecture.md](costco-onetap-architecture.md) (how the flow works),
[costco-webview-diagnostics.md](costco-webview-diagnostics.md) (manual QA + hypothesis log).

---

## TL;DR — the three real bugs and their fixes

| # | Symptom | Root cause | Fix |
|---|---------|-----------|-----|
| 1 | `wcs-err=true` redirect loop right after a **successful** B2C sign-in; no token written; 5-min hang | **Stale guest WC session** in the persistent InAppBrowser cookie jar (`WC_PERSISTENT`, `wcMember`, `kmsi`, `sso-pharmacy-session`) collided with the B2C→WCS exchange at `OAuthLogonCmd` | **Pre-login session clear**: `clearSessionBeforeLogin` clears cookies + cache before opening login. See `clearSessionBeforeLogin` in [webViewBridge.js](../frontend/src/services/webViewBridge.js) + config in [costcoWebViewBridge.js](../frontend/src/services/costcoWebViewBridge.js) |
| 2 | 5-min hang instead of a fast, recoverable error when #1 happened | Loop detector required 10 hits and `CombinedSigninAndSignup` reset the counter right before failure, so it never tripped | **Post-auth fast-fail**: `evaluateLoginLoopDetection` arms on `authCompletePatterns` then trips after `postAuthThreshold` (2) `wcs-err` hits. See [webViewBridge.js](../frontend/src/services/webViewBridge.js) |
| 3 | **No `webview debug:` lines ever reached the backend** `/api/dev/log`, so we were debugging blind | Costco script called `mobileApp.postMessage(JSON.stringify(...))`. On **iOS** the `@capgo/inappbrowser` plugin casts the body `as? [String:Any]`; a **string** fails the cast and arrives as `{ rawMessage: '...' }`, hiding `type`/`message`/`data` | **Pass an object, not a JSON string**: `postMsg(type, payload)` → `postMessage({detail:{...}})` in [costcoExtractScript.js](../frontend/src/services/costcoExtractScript.js). Bridge also defensively parses legacy `rawMessage` via `normalizeWebViewMessageDetail` in [webViewBridge.js](../frontend/src/services/webViewBridge.js) |

If Costco login breaks again, **check these three first** before forming new theories.

---

## What the flow looks like when healthy

```
pre-login session cleared
→ startLogin opening url=https://www.costco.com
→ user signs in on signin.costco.com (B2C)
→ CombinedSigninAndSignup/confirmed         (B2C auth OK)
→ www.costco.com/OAuthLogonCmd              (WCS exchange)
→ www.costco.com/?...&krypto=...            (NO wcs-err)
→ .../myaccount/#/.../ordersandpurchases
→ webview debug: doFetchReceipts success {"receiptCount":N}
→ POST /api/providers/costco/store-receipts 200
```

Silent sync follows the same pattern without the interactive login step.

---

## Hypotheses we chased — and the verdicts

- **H-stale-token (Problem B, earlier round):** expired MSAL token picked over a fresh one.
  *Partially real* — fixed by `findFreshCredential` (skip expired, pick latest `exp`) in
  [costcoExtractScript.js](../frontend/src/services/costcoExtractScript.js) — but **not** the
  cause of the June `wcs-err` failure (no token was ever written there).
- **H3 — Akamai bot-scoring the WebView User-Agent.** The UA on every diagnostic is
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)`
  — missing the `Version/... Safari/...` suffix, a classic bot-flag shape.
  **RULED OUT as the cause:** a clean retry (same UA) succeeded end-to-end. If UA were the
  problem, the retry would fail too. The native Safari-UA override is therefore **deferred /
  not needed**; do not implement it speculatively.
- **H-policy-drift (B2C policy ID changed):** ruled out — `B2C_1A_SSO_WCS_signup_signin_209`
  authenticates fine; failure was strictly the downstream WCS exchange.
- **Actual cause:** stale cookie jar (#1 above), proven because clearing cookies — which the
  post-auth fast-fail + `clearCostcoInAppBrowserSession()` did automatically — made the very
  next attempt succeed.

---

## How we got evidence (diagnostics that stay in the code)

These were the breakthrough — keep them:

- **`cookieProbe`** (bridge-side, native `getCookies`): logs cookie **key names only** at
  `OAuthLogonCmd` / `wcs-err`. Surfaced the stale `WC_PERSISTENT`/`wcMember` guest session.
- **`getDiagnosticScript()` / `login-diagnostic`**: read-only UA + lsKeys + cookie names,
  injected on every host (bypasses skip-injection). Safe on signin/OTP hosts.
- **`script_run` heartbeat + `doFetchReceipts entry/headers/response/success`**: confirm the
  injected script runs and the in-WebView GraphQL succeeds.

All of these ride over `mobileApp.postMessage({detail:{...}})` and land in backend
`/api/dev/log` as `[costcoLogin] webview debug: ...`. **If those lines are missing, suspect
bug #3 (message shape) before anything else.**

---

## Gotchas / non-issues (do not "fix" these)

- **`duplicate key value violates unique constraint "receipts_order_id_key"`** during sync is
  **expected, idempotent** behavior — the same receipt was already stored. HTTP response is
  still `200`. Not a failure.
- **`script_run` repeating every ~3s** on `www.costco.com/?krypto=...` before `ordersandpurchases`
  is the extract script re-injecting until tokens appear. Noisy but harmless.
- **Pre-login clear means the user re-enters credentials each interactive login.** Accepted
  trade-off; it is the proven fix for the stale-session loop. Safeway is unaffected
  (`clearSessionBeforeLogin` is Costco-only).
- **iOS postMessage must be an object.** Never reintroduce `JSON.stringify(...)` into a
  `mobileApp.postMessage(...)` call — see Safeway's `postMsg` for the canonical pattern.

---

## Regression guard

MSAL token-freshness logic lives once in
[costcoMsalCredentialSource.js](../frontend/src/services/costcoMsalCredentialSource.js)
(`MSAL_CREDENTIAL_JS`), embedded in the inject script and exercised by
[costcoMsalTokenHelpers.test.js](../frontend/src/tests/costcoMsalTokenHelpers.test.js).

Tests in [webViewBridge.test.js](../frontend/src/tests/webViewBridge.test.js) and
[useCostcoSync.test.js](../frontend/src/tests/useCostcoSync.test.js) cover: pre-login clear
(Costco yes / Safeway no), post-auth fast-fail arm+trip, cookie probe, **behavioral**
object-shaped postMessage (script execution, not source-string grep), end-to-end debug routing
(object + iOS `rawMessage` → `/api/dev/log` fetch body), and `normalizeWebViewMessageDetail`.
Run `cd frontend && npm test` before shipping changes to any Costco/WebView file.
