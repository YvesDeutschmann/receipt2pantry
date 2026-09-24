# Area 5 — Android sign-off (physical device, prod API)

Companion to [`06-launch-readiness.md`](../implementation_briefs/mvp_gaps/06-launch-readiness.md) sections **5b–5d**.  
**Prod API:** `https://api.meald.app`  
**Supabase project:** `pvmezsxdqotxaqfymmzd`

This runbook records **operator sign-off** for the signed Play / internal-testing Android build. iOS remains a separate gate.

---

## QA account (Sep 2026 reinstall run)

| Field | Value |
|--------|--------|
| `user_id` | `46aa5da5-bd44-4f9c-9b57-f34cd83de04a` |
| Sign-in | Google (Android) |
| Store | Safeway |
| Fresh install funnel | 2026-09-22 ~4:22–4:25 PM PT (`funnel_sign_in` … `funnel_first_suggestion_viewed`) |

---

## Gate status (Android)

Legend: **PASS** | **PASS (device)** | **OPEN** | **N/A**

| Gate | Item | Status | Evidence |
|------|------|--------|----------|
| **5b** | Signed release AAB/APK against prod | **PASS** | Play internal build exercised against `api.meald.app` (2026-07-28 artifact line + Sep 2026 device runs) |
| **5c.1** | Fresh install | **PASS (device)** | New install + onboarding funnel E1–E5 in `funnel_events` |
| **5c.2** | Sign in with Google | **PASS** | `funnel_sign_in` |
| **5c.3** | Household + dietary + connect store | **PASS** | `funnel_store_connected` |
| **5c.4** | Initial sync; no reconnect on success | **PASS** | `login` `sync_succeeded` (~102s); no reconnect UX during onboarding |
| **5c.5** | Staples template &lt; 2 minutes | **PASS** | `funnel_staples_confirmed` ~3 min after sign-in; `staplesCount: 27` |
| **5c.6** | ≥1 suggestion (warm pool) | **PASS** | `funnel_first_suggestion_viewed`; operator: suggestions usable on Dinner |
| **5c.7** | Mark cooked → pantry updates | **PASS** | `cooking_log` (Ultimate Game Day Chicken Nachos); `cook_logged` in `funnel_repeatable_events` |
| **5c.8** | Background / foreground → auto-sync | **PASS** | `silent` `sync_succeeded` 2026-09-23 ~5:41 AM PT (`sync_attempt_outcomes`) |
| **5c.9** | No `console.error` / native crash (Logcat) | **OPEN** | Not captured in Postgres; operator has not filed a formal Logcat pass note |
| **5d** | Invalid store session → visible reconnect | **PASS (device)** | 2026-09-23 ~6:27 AM PT: toast + reconnect banner after Safeway silent attempt (session invalidated via Costco Connect opening — see [`reconnect.md`](reconnect.md)) |
| **5d** | Reconnect → sync succeeds | **PASS** | `login` `sync_succeeded` ~78s immediately after (~6:29 AM PT) |
| **5d** | `sync_events` terminal `needs_reconnect` | **OPEN** | No `needs_reconnect` row for this user — **manual Providers “Silent Sync”** fires UI events but does not call `reportAnomaly(..., needs_reconnect)` (see follow-ups below). Auto-sync scheduler **does** log the phase. |
| **Funnel E6** | `funnel_first_cook_logged` | **OPEN** | Absent in `funnel_events` (cook API + `cooking_log` OK; telemetry flush gap) |
| **iOS 5c/5d** | Dual-platform Area 5 | **N/A here** | Not signed off on this doc |

### Summary

- **Android product gates (5c core + 5d UX): signed off on device** for the QA account above.
- **Android paperwork gaps:** 5c.9 Logcat, optional E6 funnel event, server-side `needs_reconnect` when reconnect was triggered via **manual** silent sync.
- **Full Area 5 (dual-platform): not complete** until iOS checklist is recorded the same way.

---

## Engineering follow-ups (post–Area 5 Android validation)

Track in [`reconnect.md`](reconnect.md) and implementation briefs; do not block the device UX sign-off above.

1. **Telemetry parity — manual silent sync**  
   `useSafewaySync.startSilent` (Providers **Silent Sync** button) dispatches `safeway-sync-needs-reconnect` but does **not** call `reportAnomaly` / `logPhase` with `SyncPhase.NEEDS_RECONNECT`. Foreground auto-sync (`useAppSyncScheduler` → `dispatchOutcomeEvent`) already does. **Action:** mirror scheduler behavior on the manual path (including fetch-auth `expired` branches). See [`01b-foreground-auto-sync.md`](../implementation_briefs/mvp_gaps/01b-foreground-auto-sync.md).

2. **Costco login session clear — scope to Costco only**  
   Today `clearSessionBeforeLogin` on Costco runs `InAppBrowser.clearAllCookies({})`, which **also removes Safeway’s** `SWY_SHARED_SESSION` in the shared WebView jar. That was useful to **reproduce** Safeway reconnect during Area 5 QA (open Costco Connect, cancel). **After this sign-off is accepted:** change Costco pre-login cleanup to clear **Costco tokens / MSAL / Costco-origin cookies only**, not the global cookie jar — so connecting Costco does not silently disconnect Safeway. See [`costco-login-postmortem.md`](../costco-login-postmortem.md) and `.cursor/rules/costco-webview-sync.mdc`.

---

## Useful SQL (service role / MCP)

```sql
-- Funnel steps for QA user
SELECT event, occurred_at, metadata
FROM funnel_events
WHERE user_id = '46aa5da5-bd44-4f9c-9b57-f34cd83de04a'
ORDER BY occurred_at;

-- Sync outcomes (latest first)
SELECT provider, mode, terminal_phase, terminal_reason, started_at, duration_ms
FROM sync_attempt_outcomes
WHERE user_id = '46aa5da5-bd44-4f9c-9b57-f34cd83de04a'
ORDER BY started_at DESC
LIMIT 20;

-- Reconnect phases (if logged)
SELECT provider, mode, phase, reason, occurred_at
FROM sync_events
WHERE user_id = '46aa5da5-bd44-4f9c-9b57-f34cd83de04a'
  AND phase = 'needs_reconnect'
ORDER BY occurred_at DESC;
```
