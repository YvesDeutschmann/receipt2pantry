# M3 — Activation Funnel Telemetry

> **Prerequisite:** Brief `01b-foreground-auto-sync.md` must be complete (auto-sync scheduler wired and default-on) before this brief is implemented. Read `docs/MVP_SCOPE_AND_ROADMAP.md` §3.1-A and §6 M3. Read `frontend/src/services/syncTelemetry.js` for the Capacitor Preferences + localStorage storage pattern to reuse.
>
> **Scope:** One new frontend service (`funnelTelemetry.js`), six emit points wired into existing components/contexts, and a dev-panel inspection hook. **Client-only telemetry** — no backend endpoint in this phase. No behavior change to any existing feature; funnel events are fire-and-forget side effects.
>
> **Do NOT touch in this phase:** `syncTelemetry.js` (reuse, do not modify); any backend route; the cold-start arc control flow in `ColdStartContext.jsx`, `OnboardingContext.jsx`, or `StaplesTemplate.jsx`; the recipe ranking or suggestion logic in `Recipes.jsx`; the cook/depletion logic in `Pantry.jsx`.

---

## Objective

Instrument the six activation-funnel touchpoints so that after launch we can answer: "What fraction of new users reached first suggestion in under 3 minutes? Where did they drop off?" Events are persisted locally (Capacitor Preferences on-device, localStorage in web fallback), survive app restarts, fire exactly once per funnel step per user, and contain no PII. A dev-flag exposes all stored events for on-device inspection during M3 TestFlight QA.

---

## Technical Contract

### 1. `frontend/src/services/funnelTelemetry.js` (new)

#### 1a. Event enum

```js
/** @enum {string} */
export const FunnelEvent = {
  SIGN_IN:                 'funnel_sign_in',
  STORE_CONNECTED:         'funnel_store_connected',
  RECEIPTS_SYNCED:         'funnel_receipts_synced',
  STAPLES_CONFIRMED:       'funnel_staples_confirmed',
  FIRST_SUGGESTION_VIEWED: 'funnel_first_suggestion_viewed',
  FIRST_COOK_LOGGED:       'funnel_first_cook_logged',
}
```

#### 1b. Event payload shape (stored as NDJSON array under a single Preferences key)

```js
{
  event:     string,       // FunnelEvent value
  userId:    string,       // Supabase user.id — REQUIRED at emit time; never store email/tokens
  timestamp: number,       // Date.now() — overridable via options.now for deterministic tests
  sessionId: string,       // per-app-session UUID generated once at module init; reset on cold launch
  metadata:  object,       // optional; all values must be primitives; NO item names/emails/tokens
}
```

The session ID is a module-level constant initialized with `crypto.randomUUID()` when the module is first imported. It allows grouping events within a single cold-start session without tying them to the auth user.

Storage key: `funnel_telemetry` (single JSON array, all events for all users, capped at **200 entries** — drop oldest on overflow). Uses the same Preferences + localStorage probe ladder as `syncTelemetry.js` (copy the `isPreferencesAvailable` pattern; do not import from `syncTelemetry.js` directly).

#### 1c. Public API

```js
/**
 * Record a funnel event. Idempotent: if this event has already been recorded
 * for this userId, the call is a silent no-op.
 * @param {FunnelEvent} event
 * @param {string} userId  - Supabase user.id (required; do not pass email)
 * @param {object} [metadata] - optional primitive-value context
 * @param {{ now?: number }} [options] - override timestamp for tests
 * @returns {Promise<void>}
 */
export async function emit(event, userId, metadata = {}, options = {}) { /* ... */ }

/**
 * Return all stored funnel events. Dev/QA use only.
 * @returns {Promise<Array>}
 */
export async function dump() { /* ... */ }

/**
 * Wipe all stored funnel events. Test/QA use only.
 * @returns {Promise<void>}
 */
export async function reset() { /* ... */ }

/**
 * Returns the module-level session ID for the current app launch.
 * @returns {string}
 */
export function getSessionId() { /* ... */ }
```

**Idempotency rule:** Before appending a new event, `emit` reads the stored array and checks whether an entry with matching `{ event, userId }` already exists. If yes, return without writing. This ensures each funnel step fires at most once per user (across sessions).

**Offline tolerance:** Both storage backends (Preferences and localStorage) are synchronous/local; `emit` never makes a network call and must not throw to the caller. Wrap all storage I/O in try/catch with silent failure (log `console.warn` at most).

**PII guardrail:** `emit` must not accept or store email addresses, auth tokens, provider credentials, or receipt item names. If `userId` is null/undefined/empty, the call is a no-op (do not store the event).

#### 1d. Dev-panel inspection

When `localStorage.getItem('FUNNEL_TELEMETRY_DEV_PANEL') === '1'`, expose `window.__funnelTelemetry` as an object with `{ dump, reset, getSessionId }` so a QA engineer can inspect/clear events from the browser console or Safari/Chrome DevTools on-device. This assignment must be wrapped in:

```js
if (typeof window !== 'undefined' && window.localStorage?.getItem('FUNNEL_TELEMETRY_DEV_PANEL') === '1') {
  window.__funnelTelemetry = { dump, reset, getSessionId }
}
```

Executed once at module init (not on every `emit` call).

---

### 2. Emit points — six wires into existing files

All six are **additive side effects** — no control-flow change to the host component.

#### E1 — `SIGN_IN` in `frontend/src/contexts/AuthContext.jsx`

**Location:** Inside `onAuthStateChange` callback, when `_event === 'SIGNED_IN'` and `sess?.user?.id` is truthy.

```js
// After: setUser(sess?.user ?? null)
if (_event === 'SIGNED_IN' && sess?.user?.id) {
  void emit(FunnelEvent.SIGN_IN, sess.user.id)
}
```

Import `{ emit, FunnelEvent }` from `'../services/funnelTelemetry'`. Because this context may mount before `user` is available, use `sess.user.id` directly from the callback argument.

**Idempotency:** handled inside `funnelTelemetry.emit` — fires once per user across all sign-ins.

#### E2 — `STORE_CONNECTED` in `frontend/src/contexts/ColdStartContext.jsx`

**Location:** A `useEffect` watching `groceryConnectedFlag`. When it transitions to `true` and `user?.id` is truthy:

```js
useEffect(() => {
  if (groceryConnectedFlag && user?.id) {
    void emit(FunnelEvent.STORE_CONNECTED, user.id)
  }
}, [groceryConnectedFlag, user?.id])
```

This covers both Costco (token stored → `groceryConnectedFlag` set via `user_metadata.cold_start_grocery_connected`) and Safeway (same metadata flag). The `emit` idempotency prevents double-fire if the effect re-runs.

#### E3 — `RECEIPTS_SYNCED` in `frontend/src/contexts/ColdStartContext.jsx`

**Location:** A `useEffect` watching `receiptSyncStatus`. When `receiptSyncStatus === 'success'` and `user?.id` is truthy:

```js
useEffect(() => {
  if (receiptSyncStatus === 'success' && user?.id) {
    void emit(FunnelEvent.RECEIPTS_SYNCED, user.id, {
      matchCount: receiptMatchCount,
    })
  }
}, [receiptSyncStatus, user?.id])
```

`matchCount` is a numeric primitive — safe to store.

#### E4 — `STAPLES_CONFIRMED` in `frontend/src/pages/onboarding/StaplesTemplate.jsx`

**Location:** After the successful API call that confirms staples (the handler that calls `api.confirmStaples(...)` or the equivalent `OnboardingContext` step completion). Emit after the promise resolves without error:

```js
// After staples confirmation succeeds:
void emit(FunnelEvent.STAPLES_CONFIRMED, user.id, {
  staplesCount: confirmedCount,  // number of items confirmed — safe primitive
})
```

`user` is available via `useAuth()` (already imported in `StaplesTemplate.jsx`). `confirmedCount` must be a count, not item names.

#### E5 — `FIRST_SUGGESTION_VIEWED` in `frontend/src/pages/Recipes.jsx`

**Location:** Inside the `useEffect` that sets `suggestions` state (after `fetchSuggestionsPayload` resolves). Emit when the resolved `suggestions` object has at least one item in any tier and `user?.id` is truthy. Use a `useRef` guard to ensure this fires at most once per component mount (in addition to `emit`'s storage-level idempotency):

```js
const firstSuggestionEmitted = useRef(false)

// Inside useEffect after setSuggestions(next):
const hasAnySuggestion =
  (next.cook_tonight?.length > 0) ||
  (next.check_first?.length > 0) ||
  (next.stretch_goals?.length > 0)
if (hasAnySuggestion && user?.id && !firstSuggestionEmitted.current) {
  firstSuggestionEmitted.current = true
  void emit(FunnelEvent.FIRST_SUGGESTION_VIEWED, user.id)
}
```

#### E6 — `FIRST_COOK_LOGGED` in `frontend/src/pages/Pantry.jsx`

**Location:** After a successful `POST /pantry/cook` or `/pantry/consume` call. The existing cook-confirmation flow already handles success state; emit there:

```js
// After cook API call resolves successfully:
void emit(FunnelEvent.FIRST_COOK_LOGGED, user.id)
```

`user` is available via `useAuth()`. Use the same `useRef` guard pattern as E5 if the component might fire multiple cook events in one session — `emit` idempotency handles cross-session deduplication; `useRef` prevents same-session noise.

---

### 3. Cold-start timing metadata (`sessionId` + `timestamp` correlation)

The `timestamp` on each event is `Date.now()`. Because all events share the same module-level `sessionId` for a given app launch, a QA engineer (or post-launch analysis) can reconstruct the cold-start arc time as:

```
Δt = FIRST_SUGGESTION_VIEWED.timestamp - SIGN_IN.timestamp
```

for events sharing the same `sessionId`. No additional timing infrastructure is needed for M3.

---

## Logic Guardrails

- **No PII:** `userId` stored is the Supabase UUID (opaque identifier). Email addresses, display names, auth tokens, provider credentials, receipt item names, and dietary restrictions must never appear in `metadata`. Enforce in `emit` by not accepting or forwarding those keys (the caller is responsible for not passing them, but `emit` must also silently drop any `metadata` key whose value is not a primitive — `typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean'` → omit).
- **Exactly-once per funnel step per user:** The idempotency check (`event + userId` dedup in stored array) must read the persisted blob, not in-memory state. This ensures the invariant survives app restarts.
- **Offline tolerance:** `emit` must never reject. Wrap all `Preferences.get` / `Preferences.set` and `localStorage` calls in try/catch. On any error, log `console.warn('[FunnelTelemetry] storage error:', e)` and return without throwing.
- **Deterministic timestamps for tests:** `emit` accepts `options.now` (epoch ms integer) to override `Date.now()`. Every test that checks timestamps must pass `options.now`.
- **Cross-platform (Capacitor) safe:** Storage probe (`isPreferencesAvailable`) must execute on every `emit` call for the first call, then cache the result (module-level boolean). Do not assume Capacitor is available in web/test environments.
- **Cap at 200 entries:** Before appending, if `stored.length >= 200`, splice the oldest entries so the array stays at 199 before pushing the new one. This prevents unbounded growth on long-lived installs.
- **No network calls:** `funnelTelemetry.js` must not import `apiClient.js` or call `fetch`. This is client-only telemetry in this phase.
- **`window.__funnelTelemetry` only in dev-panel mode:** The `window` assignment must be guarded by the localStorage flag check. It must not execute in production unless the flag is explicitly set.

---

## Test-First Suite

All tests live in `frontend/src/services/__tests__/funnelTelemetry.test.js` and run with `vitest`. Mock `@capacitor/preferences` and `localStorage` using the same inline mock pattern as `syncTelemetry.test.js`.

### Core storage + idempotency

- `EMIT_RECORDS_EVENT_IN_STORAGE` — call `emit(FunnelEvent.SIGN_IN, 'user-uuid-1', {}, { now: 1000 })`; call `dump()`; assert array contains one entry with `{ event: 'funnel_sign_in', userId: 'user-uuid-1', timestamp: 1000 }`.
- `EMIT_IDEMPOTENT_SAME_EVENT_SAME_USER` — emit `SIGN_IN` for `user-uuid-1` twice; `dump()` returns exactly one entry.
- `EMIT_NOT_IDEMPOTENT_DIFFERENT_EVENTS` — emit `SIGN_IN` then `STORE_CONNECTED` for same user; `dump()` returns two entries.
- `EMIT_NOT_IDEMPOTENT_DIFFERENT_USERS` — emit `SIGN_IN` for `user-uuid-1` and `user-uuid-2`; `dump()` returns two entries.
- `EMIT_NOOP_WHEN_USER_ID_EMPTY` — `emit(FunnelEvent.SIGN_IN, '')` and `emit(FunnelEvent.SIGN_IN, null)` — `dump()` returns empty array.
- `EMIT_SURVIVES_CORRUPT_STORAGE` — pre-populate storage with invalid JSON; `emit` must not throw; `dump()` returns at least the newly emitted event.
- `EMIT_CAPS_AT_200` — emit 201 distinct `(event, userId)` pairs (use unique fake `userId` values); `dump()` returns exactly 200 entries (oldest dropped).

### Timestamp + session ID

- `EMIT_USES_NOW_OVERRIDE` — `emit(..., { now: 42000 })`; assert `timestamp === 42000` in stored entry.
- `EMIT_USES_DATE_NOW_BY_DEFAULT` — spy on `Date.now`, return fixed value; emit without override; assert stored timestamp matches spy return.
- `GET_SESSION_ID_RETURNS_CONSISTENT_VALUE` — `getSessionId()` called twice returns same string; value is non-empty.

### Metadata PII guardrail

- `EMIT_DROPS_OBJECT_METADATA_VALUES` — pass `metadata: { count: 3, label: 'ok', nested: { x: 1 } }`; stored entry has `metadata.count === 3`, `metadata.label === 'ok'`, and `metadata.nested` is absent.
- `EMIT_STORES_PRIMITIVE_METADATA` — `metadata: { staplesCount: 12 }`; stored `metadata.staplesCount === 12`.

### Reset

- `RESET_CLEARS_ALL_EVENTS` — emit two events; call `reset()`; `dump()` returns `[]`.

### Dev panel

- `DEV_PANEL_NOT_EXPOSED_BY_DEFAULT` — without setting `FUNNEL_TELEMETRY_DEV_PANEL`, `window.__funnelTelemetry` is undefined after module import.
- `DEV_PANEL_EXPOSED_WHEN_FLAG_SET` — set `localStorage.FUNNEL_TELEMETRY_DEV_PANEL = '1'` before import (or re-init); `window.__funnelTelemetry` exposes `{ dump, reset, getSessionId }`.

---

## Definition of Done

- [ ] `frontend/src/services/funnelTelemetry.js` exists and exports `emit`, `dump`, `reset`, `getSessionId`, `FunnelEvent`.
- [ ] All six emit points (E1–E6) wired; each is a non-blocking `void emit(...)` call with no try/catch in the host component (errors are swallowed inside `funnelTelemetry`).
- [ ] All vitest cases in `funnelTelemetry.test.js` pass (`npm test` in `frontend/`).
- [ ] `rg 'funnelTelemetry' frontend/src` matches only: the new service file, the six host files, and test files. No other production callers.
- [ ] `rg 'email\|\.email\|user\.email' frontend/src/services/funnelTelemetry.js` — zero matches.
- [ ] Manual on-device smoke (iOS Simulator or TestFlight build):
  - Set `localStorage.FUNNEL_TELEMETRY_DEV_PANEL = '1'` in Safari Web Inspector.
  - Walk the full cold-start arc (sign in → connect Safeway or Costco → wait for sync → confirm staples → view Recipes → tap "I cooked this").
  - Run `window.__funnelTelemetry.dump()` in console — all six events present in order, all with the same `sessionId`, `userId` is a UUID (not an email), timestamps are monotonically increasing.
  - `Δt = FIRST_SUGGESTION_VIEWED.timestamp - SIGN_IN.timestamp < 180000` (< 3 min) for a successful cold-start.
- [ ] No new ESLint errors in touched files.
- [ ] Existing vitest and pytest suites still pass.

### Logic Audit

Before marking done, produce a bullet-list confirming:

- [ ] `emit` never calls `fetch` or imports `apiClient.js` — confirmed.
- [ ] `emit` idempotency check reads from persisted storage, not in-memory — confirmed.
- [ ] `getSessionId()` returns a stable UUID for the process lifetime (not regenerated on each call) — confirmed.
- [ ] `window.__funnelTelemetry` assignment is guarded behind `FUNNEL_TELEMETRY_DEV_PANEL` flag — confirmed.
- [ ] E4 (`STAPLES_CONFIRMED`) metadata contains `staplesCount` (integer) only, not item names — confirmed.
- [ ] E3 (`RECEIPTS_SYNCED`) metadata contains `matchCount` (integer) only, not receipt content — confirmed.
- [ ] All six host files (`AuthContext.jsx`, `ColdStartContext.jsx` ×2, `StaplesTemplate.jsx`, `Recipes.jsx`, `Pantry.jsx`) use `void emit(...)` with no await and no try/catch at the call site — confirmed.

---

## Appendix: On-Device QA Checklist for M3 Cold-Start Arc

> **Note:** This appendix covers the broader M3 "cold-start arc hardening on-device" quality gate. Funnel telemetry (above) is the build deliverable; this checklist is the QA gate.

### Prerequisites
- TestFlight build installed on ≥ 1 iPhone (iOS 16+) and ≥ 1 Android device (API 31+).
- Fresh account (no prior onboarding) or account reset.
- Safari Web Inspector (iOS) or Chrome DevTools remote debugging (Android) connected.
- `FUNNEL_TELEMETRY_DEV_PANEL=1` set in localStorage before starting.

### iOS checklist
- [ ] **Sign in:** Email/password sign-in completes; `funnel_sign_in` event in `dump()`.
- [ ] **Connect Safeway:** Safeway WebView launches, user logs in; `cold_start_grocery_connected` sets to true; `funnel_store_connected` event appears.
- [ ] **Receipt sync (foreground):** Auto-sync triggers on connect or "Sync now"; receipts appear in pantry; `funnel_receipts_synced` event with `matchCount > 0`.
- [ ] **Sync-still-running state:** Restart app mid-sync; app shows a visible progress indicator (not a blank state); sync completes without double-fetch or crash.
- [ ] **Staples confirmation:** Onboarding staples screen loads with template; user confirms; `funnel_staples_confirmed` event with `staplesCount > 0`.
- [ ] **First suggestion:** Recipes page loads; at least one suggestion visible; `funnel_first_suggestion_viewed` event.
- [ ] **Cold-start Δt < 3 min:** `FIRST_SUGGESTION_VIEWED.timestamp - SIGN_IN.timestamp < 180000` ms.
- [ ] **First cook:** User taps "I cooked this" on a recipe; pantry updates (item quantity decremented or confidence adjusted); `funnel_first_cook_logged` event.
- [ ] **App backgrounded + foregrounded:** App goes to background and returns; foreground auto-sync triggers (throttled); no duplicate funnel events emitted.
- [ ] **Reconnect scenario:** Revoke Safeway session manually; reopen app; a visible "reconnect" prompt appears (not a silent failure).

### Android checklist
- [ ] Repeat all iOS checklist items on Android (API 31+).
- [ ] **Costco connect path:** If testing with Costco, confirm One-Tap WebView token capture works on Android; `funnel_store_connected` fires.
- [ ] **Back-button behavior:** Android back button during onboarding does not skip a step or leave the user on a blank screen.
- [ ] **Keyboard/IME:** Staples search and recipe search inputs are not obscured by the soft keyboard.

### Pass criteria
All checklist items must pass on at least one iOS device and one Android device before M3 exit gate is declared.
