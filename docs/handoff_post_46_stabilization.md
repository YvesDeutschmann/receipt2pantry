# Handoff: post-PR46 stabilization, iOS Costco regression

Use this as the starting context for a fresh chat. It captures the problem, what's been shipped, what's blocked, and what to do next. The full plan file is at [.cursor/plans/split-current-branch-prs_c2633de4.plan.md](../.cursor/plans/split-current-branch-prs_c2633de4.plan.md).

## TL;DR

- Working on **`fix/post-46-stabilization`** integration branch.
- **7 draft PRs** are open (#47–#53). 5 are unblocked. 2 are blocked on an iOS Costco regression.
- **iOS Costco visible login + receipts extraction is broken.** Backend gets **zero** events from iOS Costco. Safeway on iOS works.
- **Android works for both providers.**
- **Root cause identified (2026-05-20):** Costco extract script passes `JSON.stringify(...)` to `mobileApp.postMessage`. iOS Capgo casts `message.body as? [String: Any]`; the cast fails and events arrive as `{ rawMessage: "..." }` instead of `{ detail: {...} }`. The bridge only reads `event.detail`, so every message is silently dropped. Safeway already uses object payloads — see [frontend/src/services/safewayExtractScript.js](../frontend/src/services/safewayExtractScript.js) lines 28–42.
- **Fix in PR #52:** adopt Safeway's object payload pattern in `costcoExtractScript.js` + defensive `rawMessage` fallback in `webViewBridge.js`. The earlier `__capgoBridge` / SPA-shadowing hypothesis was **disproven** by iOS simulator logs.

## Resolution (2026-05-20)

iOS simulator Xcode logs showed `page-diagnostic` and `tryPost-tick` reaching native with:

```text
Received non-dictionary message from JavaScript: {"detail":{"type":"costco-webview-fetch-debug",...
⚡️ TO JS {"rawMessage":"{\"detail\":{\"type\":\"costco-webview-fetch-debug\",...
```

Messages **do** reach Capgo native — they are not lost to Costco SPA bridge shadowing. The host JS bridge drops them because it only handles `event.detail`.

**Fix (PR #52, repurposed):**

1. [frontend/src/services/costcoExtractScript.js](../frontend/src/services/costcoExtractScript.js) — pass `{ detail: { type, ... } }` objects to `postMessage` (mirror Safeway's `postMsg` helper).
2. [frontend/src/services/webViewBridge.js](../frontend/src/services/webViewBridge.js) — parse `event.rawMessage` when `event.detail` is missing (belt-and-suspenders).
3. Remove the now-unnecessary `preExtractVars` / `__capgoBridge` capture from [frontend/src/services/costcoWebViewBridge.js](../frontend/src/services/costcoWebViewBridge.js).

**Verification gate:** After rebuild, simulator should show `[costcoWebViewBridge] [WebView] page-diagnostic` in JS console / backend `/dev/log` within seconds of opening Costco WebView (no login required). TestFlight must show full chain through `msal-tokens-found` before #51 and #52 merge.

## Repo state right now

| Branch | Base | PR | Status | Contents |
|--------|------|----|--------|----------|
| `fix/post-46-stabilization` | `master` | — (no PR) | integration | All work, used for Phase 1 device QA |
| `feat/dev-api-ngrok` | `master` | **#47** | draft | Dev API base URL override, Settings Dev Tools, `021_app_config.sql`, `ngrok-backend.js`, main.jsx bootstrap |
| `chore/ios-testflight-signing` | `master` | **#48** | draft | `project.pbxproj` manual signing only |
| `fix/safeway-order-id-dedup` | `master` | **#49** | draft | Multi-ID candidate match against `knownOrderIds` |
| `fix/staples-template-errors` | `master` | **#50** | draft | `e.message` fallback + `signOut` import |
| `fix/costco-option-a-no-wipe` | `master` | **#51** | draft, **blocked** | Removes preemptive Akamai/MSAL wipe + `patch-capgo-inappbrowser.js` |
| `fix/costco-capgo-bridge-ref` | `fix/costco-option-a-no-wipe` | **#52** | draft, **blocked** | iOS Costco object `postMessage` payloads + `rawMessage` fallback in shared bridge |
| `feat/onboarding-phase-a-diagnostics` | `feat/dev-api-ngrok` | **#53** | draft | Phase A diagnostics + `[apiClient] no-session` log line |

Adjacent (separate work, **not** in stack):

- `cursor/supabase-explicit-grants-4008` — explicit `GRANT` migration **022** for all 26 public tables ahead of Supabase's May 30 / Oct 30 2026 deadline. **`app_config` is NOT granted** in 022. Add a `GRANT` for `app_config` before #47 lands.

## Phase 1 device QA results

### Android (Pixel 8) — works

- Costco visible + silent — works. Backend logs show full `page-diagnostic` → `msal-tokens-found` → `doFetchReceipts success` chain.
- Safeway visible — works.
- Safeway silent — **times out at 15s on first try** (`[safewaySilent] silent timeout 15s lastUrl=https://www.safeway.com/`). Retry with visible WebView works. Pre-existing issue, not iOS-specific, not blocking.

### iOS (TestFlight) — Costco broken

- Sign in to app — works.
- Providers list / household assignment — works.
- Safeway visible login — works (39 `tryExtract` polls before `tokens_ready`).
- Safeway visible login → all receipts duplicate-rejected (PR-B fix needed).
- **Costco visible login → user navigates to Orders & Purchases → app overlay "Fetching Costco receipts" hangs forever. Backend receives ZERO events from this flow.**

The absence of `urlChange`, `page-diagnostic`, `tryPost-tick`, and `msal-tokens-found` events from iOS Costco is the key signal — those events come from different sources (bridge URL listener, extract script polling), so something is silencing them all at the same chokepoint.

## Why these PRs were created (origin story)

Master shipped two PRs that introduced a regression cluster:

- **PR #44** added `scripts/patch-capgo-inappbrowser.js` that extended `InAppBrowser.clearAllCookies()` to wipe full WebView website data on iOS/Android.
- **PR #45** added `clearBrowserSessionBeforeLogin` + `wipeAkamaiAndMsalStorageOnce` to `webViewBridge.js`. Costco bridge enabled both via `clearBrowserSessionBeforeLogin: true` and `wipeStorageHosts`.

Symptoms after that merge:
- Safeway: duplicate-receipt errors (`receipts_order_id_key` 23505) on every sync.
- Costco: `closeEvent: user closed before tokens` — extraction failed because MSAL tokens just written got wiped.
- Onboarding: "Auth session missing!" → `401 User ID required`.

Root cause for the auth bug: `clearAllCookies()` on a WKWebView clears `WKWebsiteDataStore` types that include `localStorage`, which the **main app's** Supabase session lived in.

The plan: **Option A — drop the preemptive wipe entirely**, keep the on-demand `clearCostcoInAppBrowserSession()` for error recovery. Preserved diagnostics. Removed the Capgo patch script. Defended Supabase storage with a `Capacitor Preferences` adapter, then later reverted that defense once Option A removed the only `clearAllCookies` caller on the login happy path (and to avoid forcing every user to re-sign-in).

## Retracted hypothesis: `__capgoBridge` SPA shadowing (2026-05-20)

The following was investigated and **disproven** by iOS simulator logs. Do not re-investigate unless new evidence contradicts the payload-shape diagnosis.

Original theory: PR-D's `preExtractVars` races Capgo's `window.mobileApp` install; Costco's SPA shadows `mobileApp`; posts never reach native.

**Why disproven:** Xcode logs show native receiving `page-diagnostic` and `tryPost-tick` as `Received non-dictionary message from JavaScript` with full JSON payloads. Native receives the messages; the host JS bridge drops them because iOS delivers stringified payloads as `event.rawMessage` instead of `event.detail`.

Prior art for the real fix: [frontend/src/services/safewayExtractScript.js](../frontend/src/services/safewayExtractScript.js) lines 28–42 (`postMsg` passes objects, not strings).

## Secondary issues (only if payload fix doesn't fully resolve TestFlight)

1. **Akamai 403 on `ecom-api.costco.com`** — would manifest as `doFetchReceipts response status=403` in backend logs *after* `tryPost-tick` is visible.
2. **`skipInjectionUrlPatterns`** matching too aggressively — verify last URL seen by WebView when overlay hangs. Patterns: `['signin.costco.com', 'b2clogin.com', 'login.microsoftonline.com']`.

## What to do *first* in the next session

### Merge the safe stack now

Independent of iOS Costco; deliver value immediately:

1. **PR #49** — Safeway dedup. Log proves you need this (23 duplicate errors per sync).
2. **PR #50** — Staples error UX.
3. **PR #48** — iOS TestFlight signing.
4. Add `GRANT SELECT ON public.app_config TO anon, authenticated;` to `022_explicit_data_api_grants.sql` (or amend `021_app_config.sql`).
5. **PR #47** — Dev API + ngrok. After the GRANT is in place.
6. **PR #53** — Phase A diagnostics. Base auto-rebases when #47 merges.

### Keep on hold

- **PR #51 (Option A)** and **PR #52 (iOS message-shape fix)** until iOS Costco is verified on TestFlight.

### Verify iOS Costco fix

1. Rebuild iOS via `cd frontend && npm run build:mobile`, run in simulator or archive via Xcode for TestFlight.
2. Simulator smoke (no login required): open Costco WebView; within seconds confirm `[costcoWebViewBridge] [WebView] page-diagnostic` and `tryPost-tick` in JS console and backend `/dev/log`.
3. TestFlight end-to-end: complete Costco login, tail backend `/dev/log` for `page-diagnostic` → `tryPost-tick` → `msal-tokens-found` → `doFetchReceipts success`.
4. Once green, mark #51 and #52 ready for review.

## Useful files & key code locations

- **Plan:** [.cursor/plans/split-current-branch-prs_c2633de4.plan.md](../.cursor/plans/split-current-branch-prs_c2633de4.plan.md)
- **Costco bridge config:** [frontend/src/services/costcoWebViewBridge.js](../frontend/src/services/costcoWebViewBridge.js)
- **Costco extract script:** [frontend/src/services/costcoExtractScript.js](../frontend/src/services/costcoExtractScript.js)
- **Shared WebView bridge:** [frontend/src/services/webViewBridge.js](../frontend/src/services/webViewBridge.js)
- **Costco sync hook (calls `clearCostcoInAppBrowserSession` on error):** [frontend/src/hooks/useCostcoSync.js](../frontend/src/hooks/useCostcoSync.js)
- **Backend dev-log route:** `backend/routes/dev.py` (`POST /api/dev/log`)
- **Safeway dedup site:** [frontend/src/services/safewayApiFetcher.js](../frontend/src/services/safewayApiFetcher.js)
- **Original Option A writeup:** [docs/costco_msal_wipe_fix.md](costco_msal_wipe_fix.md)
- **Costco WebView diagnostics doc:** [docs/costco-webview-diagnostics.md](costco-webview-diagnostics.md)
- **Onboarding diagnostic doc:** [docs/pantry_onboarding_session_diagnostic.md](pantry_onboarding_session_diagnostic.md)
- **Safeway dedup doc:** [docs/safeway_dedup_fix.md](safeway_dedup_fix.md)

## Guardrails (preserve these decisions)

- Capacitor `Preferences` storage adapter for Supabase was **intentionally reverted**. Don't bring it back unless any preemptive `clearAllCookies` caller is re-introduced — it would force every user to re-sign-in for no current benefit.
- `network_security_config.xml` runtime LAN injection is **machine-local**. Don't commit IP-bound state. `scripts/apply-android-lan-env.js` patches at build time.
- `baseline-browser-mapping` was an accidental devDep. Don't let it come back.
- `frontend/scripts/patch-capgo-inappbrowser.js` was deleted on purpose. Don't re-add unless we re-enable preemptive wipe (which we explicitly chose not to do — Option A).
- Phase 1 device QA is a **gate**. Don't merge #51 or #52 until iOS Costco works on TestFlight.
- Don't merge `fix/post-46-stabilization` as a single blob; it would commit unvalidated PR-A to master.

## Open questions

1. ~~Does `window.__capgoBridge` exist in iOS Costco WebView after login?~~ **Retracted** — not the bug; payload shape was the issue.
2. Why does Safeway silent sync time out at 15s consistently on first try? (Pre-existing; document, file follow-up.)
3. Should we add a `GRANT SELECT ON public.app_config` to migration 022, or amend 021 to include its own grant? (Either works; coordinate with the supabase-explicit-grants branch owner.)
4. After Option A, do we still want silent-sync fallback-to-visible for Safeway/Costco when silent times out? Would also serve as the long-term fix for the Safeway 15s timeout.
