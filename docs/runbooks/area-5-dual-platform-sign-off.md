# Area 5 — Dual-platform device sign-off (prod API)

Companion to [`06-launch-readiness.md`](../implementation_briefs/mvp_gaps/06-launch-readiness.md) sections **5a–5d**.  
**Prod API:** `https://api.meald.app`  
**Supabase project:** `pvmezsxdqotxaqfymmzd`

Operator sign-off for **signed** iOS (TestFlight) and Android (Play internal) builds against production. Simulator/emulator runs do not count.

Legend: **PASS** | **PASS (device)** | **OPEN** | **N/A**

---

## Summary (2026-09-24)

| Platform | 5c core + 5d UX | 5c.8 silent auto-sync | Paperwork gaps |
|----------|-----------------|------------------------|----------------|
| **Android** | **Signed off** (Sep 2026) | **PASS** — `silent` `sync_succeeded` | 5c.9 Logcat; E6 funnel; optional `needs_reconnect` row |
| **iOS** | **Signed off** (Sep 2026) | **PASS** — `silent` `sync_succeeded` 2026-09-24 ~4:36 AM PT | 5c.9 Xcode; E6 funnel; optional `needs_reconnect` row |

**Dual-platform Area 5 product gates: complete** for friends-beta / internal store tracks. Engineering follow-ups (telemetry parity, Costco cookie jar scope) remain tracked below — they do not reopen device UX sign-off.

---

## Android — QA account (Sep 2026 reinstall)

| Field | Value |
|--------|--------|
| `user_id` | `46aa5da5-bd44-4f9c-9b57-f34cd83de04a` |
| Sign-in | Google |
| Store | Safeway |
| Fresh install funnel | 2026-09-22 ~4:22–4:25 PM PT (`funnel_sign_in` … `funnel_first_suggestion_viewed`) |

### Gate status (Android)

| Gate | Item | Status | Evidence |
|------|------|--------|----------|
| **5b** | Signed release AAB/APK against prod | **PASS** | Play internal build vs `api.meald.app` |
| **5c.1** | Fresh install | **PASS (device)** | New install + onboarding funnel E1–E5 in `funnel_events` |
| **5c.2** | Sign in with Google | **PASS** | `funnel_sign_in` |
| **5c.3** | Household + dietary + connect store | **PASS** | `funnel_store_connected` |
| **5c.4** | Initial sync; no reconnect on success | **PASS** | `login` `sync_succeeded` (~102s); no reconnect UX during onboarding |
| **5c.5** | Staples template &lt; 2 minutes | **PASS** | `funnel_staples_confirmed`; `staplesCount: 27` |
| **5c.6** | ≥1 suggestion (warm pool) | **PASS** | `funnel_first_suggestion_viewed` |
| **5c.7** | Mark cooked → pantry updates | **PASS** | `cooking_log`; `cook_logged` in `funnel_repeatable_events` |
| **5c.8** | Background / foreground → auto-sync | **PASS** | `silent` `sync_succeeded` 2026-09-23 ~5:41 AM PT (`sync_attempt_outcomes`) |
| **5c.9** | No `console.error` / native crash (Logcat) | **OPEN** | Not captured in Postgres; no formal Logcat pass note filed |
| **5d** | Invalid store session → visible reconnect | **PASS (device)** | 2026-09-23 ~6:27 AM PT: toast + reconnect banner after Safeway silent attempt (session invalidated via Costco Connect opening — see [`reconnect.md`](reconnect.md)) |
| **5d** | Reconnect → sync succeeds | **PASS** | `login` `sync_succeeded` ~78s after (~6:29 AM PT) |
| **5d** | `sync_events` terminal `needs_reconnect` | **OPEN** | No `needs_reconnect` row — manual Providers “Silent Sync” does not call `reportAnomaly(..., needs_reconnect)`; auto-sync scheduler does when classified |
| **Funnel E6** | `funnel_first_cook_logged` | **OPEN** | Absent in `funnel_events` (cook API + `cooking_log` OK) |

---

## iOS — QA account (Sep 2026 TestFlight / device)

| Field | Value |
|--------|--------|
| `user_id` | `666909f5-4189-4ce9-8ba5-52e2e7bfbf42` |
| Sign-in | Sign in with Apple |
| Store | Safeway |
| Fresh install funnel | 2026-09-23 ~1:46–1:48 PM PT (`funnel_sign_in` … `funnel_first_suggestion_viewed`) |

### Gate status (iOS)

| Gate | Item | Status | Evidence |
|------|------|--------|----------|
| **5a** | Signed release vs prod (TestFlight) | **PASS (device)** | Physical device run against `api.meald.app` (Sep 2026) |
| **5c.1** | Fresh install | **PASS (device)** | Operator sign-off; funnel E1–E5 on first session |
| **5c.2** | Sign in with Apple | **PASS** | `funnel_sign_in`; auth provider `apple` |
| **5c.3** | Household + dietary + connect store | **PASS** | `funnel_store_connected`; onboarding metadata completed |
| **5c.4** | Initial sync; no reconnect on success | **PASS** | Onboarding `login` `sync_succeeded` (~86s); no `needs_reconnect` during arc |
| **5c.5** | Staples template &lt; 2 minutes | **PASS** | `funnel_staples_confirmed`; `staplesCount: 34` |
| **5c.6** | ≥1 suggestion (warm pool) | **PASS** | `funnel_first_suggestion_viewed` |
| **5c.7** | Mark cooked → pantry updates | **PASS** | `cooking_log` (recipe `634120`); `cook_logged` |
| **5c.8** | Background / foreground → auto-sync | **PASS** | Safeway `silent` → `sync_succeeded` **2026-09-24 ~4:36 AM PT** (`2026-09-24 11:36:21 UTC`, ~12.8s). Prior foreground attempts same night ended in `silent_timeout` before throttle window + healthy session |
| **5c.9** | No `console.error` / native crash (Xcode) | **OPEN** | Not captured in Postgres; no formal Xcode pass note filed |
| **5d** | Invalid store session → visible reconnect | **PASS (device)** | Forced reconnect (Costco connect cancel clearing shared cookie jar — same repro as Android); banner/toast observed |
| **5d** | Reconnect → sync succeeds | **PASS** | Safeway `login` `sync_succeeded` 2026-09-23 ~9:25 PM & ~9:31 PM PT after silent timeouts; later cycles logged |
| **5d** | `sync_events` terminal `needs_reconnect` | **OPEN** | No `needs_reconnect` rows for this user (silent path logged `silent_timeout` before interactive reconnect) |
| **Funnel E6** | `funnel_first_cook_logged` | **OPEN** | Absent in `funnel_events` (same telemetry gap as Android) |

---

## Engineering follow-ups (post–Area 5)

Do not block friends-beta release; track in briefs / [`reconnect.md`](reconnect.md).

1. **Telemetry parity — manual silent sync**  
   Providers **Silent Sync** should mirror scheduler `reportAnomaly` / `logPhase` for `needs_reconnect`. See [`01b-foreground-auto-sync.md`](../implementation_briefs/mvp_gaps/01b-foreground-auto-sync.md).

2. **Costco login session clear — scope to Costco only**  
   `clearSessionBeforeLogin` on Costco must not wipe Safeway `SWY_SHARED_SESSION` in the shared WebView jar after sign-off. See [`costco-login-postmortem.md`](../costco-login-postmortem.md).

3. **Funnel E6** — emit `funnel_first_cook_logged` when cook succeeds ([`03-funnel-telemetry.md`](../implementation_briefs/mvp_gaps/03-funnel-telemetry.md)).

4. **5c.9** — file one-line operator notes for Logcat (Android) and Xcode console (iOS) when convenient.

---

## Useful SQL (service role / MCP)

Replace `user_id` with the platform QA account above.

```sql
-- Funnel steps
SELECT event, occurred_at, metadata
FROM funnel_events
WHERE user_id = '<user_id>'
ORDER BY occurred_at;

-- Sync outcomes (latest first)
SELECT provider, mode, terminal_phase, terminal_reason, started_at, duration_ms
FROM sync_attempt_outcomes
WHERE user_id = '<user_id>'
ORDER BY started_at DESC
LIMIT 20;

-- Reconnect phases (if logged)
SELECT provider, mode, phase, reason, occurred_at
FROM sync_events
WHERE user_id = '<user_id>'
  AND phase = 'needs_reconnect'
ORDER BY occurred_at DESC;
```
