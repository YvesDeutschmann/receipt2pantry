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
| 4 | **No overlay, silent 5-min poll** after sign-in; **silent sync timeout** after ~15 min IdToken expiry (2026-07-29 / 2026-08-27) | Interactive: stale MSAL wedge (killed at B1). **Silent:** `tryPost()` refused expired JWT and ignored usable RefreshToken (Bug A). Pre-2026-08-29: ingest `Network Error` after Home wiped tokens and hid Silent Sync | **Diagnostics** (census, `sync_events`). **Bug B fixed:** backend reads `tfp`/`acr` (`209`). **Bug A fixed (2026-08-27):** silent path redeems RT in-WebView, writes rotation back to MSAL entry + Capacitor mirror, fails to `needs_reconnect` honestly. **Resilience (2026-08-29):** keep tokens on transient errors; freeze silent deadline while backgrounded; ingest on foreground + one retry. Device matrix S1–S5 pass (S3 2026-08-31: page `invalid_grant` → `needs_reconnect`). GraphQL stays in-WebView (Akamai). Run C closed. |

If Costco login breaks again, **check these four first** before forming new theories.

**Known diagnostic confounder (open, not a login bug):** Silent Sync right after interactive
login can inject into a leftover off-screen InAppBrowser and leftover login listeners. Flask
shows `[costcoLogin] urlChange` with `tokensReceived=true` during silent, then 45s
`s3_result kind=timeout`. That is **not** an S3 product fail. Force-stop Meald until session
cleanup ships. See [costco-token-diagnostic-runs.md](runbooks/costco-token-diagnostic-runs.md#leftover-inappbrowser-after-login-2026-08-31).

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
- **H-policy-drift (B2C policy ID changed):** **Bug B fixed (2026-08-27).** Live policy is
  `B2C_1A_SSO_WCS_signup_signin_209`; backend `_get_b2c_token_endpoint` reads `tfp`/`acr` from
  the idToken. The June `wcs-err` failure was strictly the downstream WCS exchange, not policy drift.
- **Actual cause:** stale cookie jar (#1 above), proven because clearing cookies — which the
  post-auth fast-fail + `clearCostcoInAppBrowserSession()` did automatically — made the very
  next attempt succeed.

### Bug #4 evidence corrections (2026-07-29 Phase 0)

The initial read of a truncated `page-diagnostic` log line was misleading:

- **Partial key capture:** the shipped script capped `lsKeys` / `ssKeys` at 10 names, so MSAL
  cache keys could be absent from the log even when credentials were present.
- **Pre-exchange timing:** `page-diagnostic` fired once before the OAuth code exchange, so a
  snapshot with no fresh `AccessToken` did not prove the exchange had failed — only that it had
  not completed yet.
- **`getTokenFailureCount` in `sessionStorage`:** the key's presence does not imply MSAL failed;
  its **value** was never captured in the first diagnostic pass.

Phase 0 credential census (hand-pasted DevTools snippet on a debug build) established:

- `IdToken` for `environment: signin.costco.com`, expired ~15 days, `RefreshToken` present, no
  `AccessToken`.
- `tryPost()` expiry rejection was **correct**; the failure was silent because the miss path
  logged nothing and Play `/api/dev/log` returned 403.

Diagnostic runbook: [runbooks/costco-token-diagnostic-runs.md](runbooks/costco-token-diagnostic-runs.md).

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
