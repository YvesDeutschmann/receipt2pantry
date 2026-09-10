# Store reconnect support runbook

Support home of record for the #1 expected ticket: **"My pantry isn't updating"** or **"The app says I need to reconnect my store."**

Optional: paste or link this file into Notion/wiki for support staff who do not use the repo.

## What this is (and is not)

Reconnect is a **transient signal**, not a database flag. Brief 01c forbids persisting `needs_reconnect` on `grocery_accounts`. There is **no** `connection_status` column.

| Source | Role |
|--------|------|
| Foreground auto-sync scheduler | Detects expired tokens/cookies → fires client events |
| UI (`ReconnectBanner`, toast, Needs attention) | Surfaces reconnect to the user |
| Capacitor Preferences `sync_attention` | Device-local persistence only (not Postgres) |
| Costco `POST /api/providers/costco/connect-from-app` | May return 401 JSON with `needs_reconnect: true` |
| `GET /api/providers/<name>/status` | Returns `configured` / `active` only — **not** a reconnect flag |

Supabase auth (Meald login) can still be valid while a **store** session is expired.

## Symptom identification

**User phrases:**

- "My pantry isn't updating"
- "The app says I need to reconnect"
- "Safeway/Costco sync stopped working"

**Confirm:**

1. User can open the app and use Meald (Supabase session OK).
2. Which store: **Safeway** or **Costco**.
3. Ask for a **screenshot** of any of:
   - Amber **Reconnect {Store}** banner on the Providers screen
   - Edge toast: **"{Store} needs reconnect"**
   - Dinner (`/recipes`) **Needs attention** banner with a Reconnect / Try again link

**What operators must not do:**

- Query or `UPDATE grocery_accounts.connection_status` — column does not exist.
- Tell support to rely on `/api/providers/<name>/status` for reconnect state.
- Assume reconnect failed because the user dismissed a banner (see edge case below).

## How the signal works

```text
Foreground auto-sync → auth failure → <provider>-sync-needs-reconnect event
  → ReconnectBanner / SyncToastHost / NeedsAttentionSection
  → user taps Reconnect → WebView login → tokens on device
  → <provider>-sync-completed → UI clears
```

**Backend 401 shape** (Costco connect-from-app only today):

```json
{
  "error": "Token has expired. Please sign in again.",
  "needs_reconnect": true,
  "provider": "costco",
  "reason": "expired_credentials"
}
```

`reason` values: `expired_credentials` | `token_refresh_failed` | `bot_detection`.

Safeway auth runs client-side in the WebView bridge; reconnect is driven almost entirely by client scheduler heuristics, not this JSON.

## Operator resolution steps

1. **Which store?** Safeway or Costco.
2. **Network check:** User can reach the store's website in a mobile browser (rules out geo/network block).
3. **Send user to Providers:**
   - **Dinner** `/recipes` → **Needs attention** → **Reconnect** / **Try again** → `/providers`, or
   - **Settings** → **Connected Stores** → **Manage** → `/providers`
4. On **Providers**, user taps **Reconnect {Store}** (amber banner) or **Connect** / **Sync** → complete WebView sign-in.
5. After reconnect, tap **Sync Now** / **Silent Sync** on the same screen if pantry is still stale.
6. If the issue **recurs within 24 hours** after a successful reconnect, escalate (see below).

There is no nested route like Settings → Connected Stores → [Store Name] → Reconnect. All reconnect CTAs live on `/providers`.

## Dismissed banner / stale pantry edge case

If the user dismissed the banner or cleared **Needs attention** but the pantry is still stale:

- Reconnect is still required — dismissal is session-local only.
- Direct them to **Settings → Connected Stores → Manage** → `/providers` → **Reconnect** or **Sync**.

## Safeway vs Costco

| Store | Flow | Notes |
|-------|------|-------|
| **Safeway** | WebView bridge login | Session tokens stored in device Preferences (`safeway_accessToken`, `safeway_clubCard`); cookies live in InAppBrowser jar |
| **Costco** | One-Tap WebView | Token via `connect-from-app`; check `_reconnect_response` reasons in backend logs if refresh fails |

Credentials land in `grocery_accounts` + vault (`backend/services/secrets_service.py`). Vault is Supabase-only (no AWS).

## Diagnostics (tiered)

### Support (remote tickets)

- Store name (Safeway / Costco)
- When it started
- Screenshot of banner, toast, or Needs attention block
- Whether user completed WebView reconnect and whether pantry updated

### Engineering

- [Monitoring runbook](monitoring.md) — GlitchTip P2 **provider reconnect failures**
- Search by `request_id` / `correlation_id` if user report includes one
- Backend logs: `Reconnect required for {provider}`, `expired_credentials`, provider HTTP 401/403
- Costco route: `POST /api/providers/costco/connect-from-app`

### QA / device in hand only

- Capacitor Preferences key `sync_attention` — confirms persisted attention state on device
- **Do not** ask remote users to inspect Preferences; support-facing triage uses screenshots + steps above

## Escalation

Escalate when reconnect **recurs within 24 hours** after the user successfully reconnected and synced:

1. Open a **provider-maintenance** issue (possible bot-detection or auth-flow regression).
2. Attach: provider, platform (iOS/Android), approximate time, GlitchTip issue link or `request_id`.
3. Check backend logs for HTTP **403** from the provider (bot detection) vs **401** (expired credentials).

## Forced-reconnect reproduction (Area 5 QA)

Use this hierarchy for launch sign-off. Support tickets use resolution steps above, not these.

### Primary — Area 5 sign-off (iOS + Android)

1. On a physical device with a connected store, **clear or expire** provider tokens/cookies (or use a test account with known-expired store session).
2. **Foreground** the app (auto-sync runs on foreground).
3. Confirm **banner**, **toast**, or **Needs attention** appears.
4. Tap **Reconnect** → complete WebView login.
5. Confirm banner/attention **clears** and **Sync** succeeds (pantry updates).

### Secondary — staging UI smoke only

Proves banner wiring, **not** end-to-end reconnect:

```javascript
window.dispatchEvent(new CustomEvent('safeway-sync-needs-reconnect'));
// or
window.dispatchEvent(new CustomEvent('costco-sync-needs-reconnect'));
```

Run in WebView remote debug console on `/providers`. Do **not** use this as Area 5 sign-off.

### Never

```sql
-- Column does not exist
UPDATE grocery_accounts SET connection_status = 'needs_reconnect' ...
```

## Verification checklist

- [ ] Support can follow resolution steps without referencing `connection_status`
- [ ] Nav paths match app: Dinner `/recipes` Needs attention, Settings → Connected Stores → Manage → `/providers`
- [ ] Forced-reconnect **primary** path documented for Area 5 device QA
- [ ] Forced-reconnect smoke on **physical iOS + Android** signed off in Area 5 (not owned by this runbook alone)
