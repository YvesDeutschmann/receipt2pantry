# MVP Gap 01e follow-up — Import Reliability Gaps

> **Prerequisite:** [`01e-import-reliability-surfaces.md`](01e-import-reliability-surfaces.md) is implemented and reviewed (2026-09-08). Named 01e tests pass. This brief closes the DoD items that review marked **PARTIAL** / **FAIL**. **Gap-closure review: 2026-09-08 — G1–G6 PASS.**
>
> **Scope:** Three sequential sub-phases. **01e.g1** hook outcome events (failed dispatch, mapper on login, lastRun/cooldown on manual completed). **01e.g2** prefs lifecycle (legacy lastRun delete + `SIGNED_OUT` clear). **01e.g3** classifier wiring for Safeway auth + sticky `STATUS.SKIPPED`. One sub-phase per build session.
>
> **Do NOT touch in any sub-phase:** `webViewBridge.js`, provider bridges (except if a test already mocks them), backend, Dashboard stats, Providers "Connected" pill, pantry/cook-loop, a sixth classifier / new `SYNC_OUTCOMES` value.
>
> **Do NOT touch in 01e.g1:** `AuthContext.jsx`, `useAppSyncScheduler.js` (except tests that already assert hook events).
>
> **Do NOT touch in 01e.g2:** store cards, `NeedsAttentionSection.jsx`, mapper.
>
> **Do NOT touch in 01e.g3:** Dashboard, receipts summary, prefs key shapes.

---

## Objective

01e made auto-sync honest. Manual Costco/Safeway taps, session expiry, and leftover unscoped lastRun keys still lie. Close those holes so health row + Dashboard "Needs attention" see every terminal mapper outcome, prefs stay per-user, and "Sync in progress" cannot stick.

This is **not** "make Costco/Safeway fetch work."

---

## Why each gap failed

### G1 — Hook `catch` / unexpected throws never emit `*-sync-error`

Silent mapper failures already call `dispatchProviderSyncFailed`. The outer `catch` in `useCostcoSync.startSilent` (~277) and `useSafewaySync.startSilent` (~394) only `setError` / `STATUS.ERROR`. Safeway fetch throws non-auth (`throw fetchErr`) land in that catch. Login `startSync` catch paths are the same.

`useProviderAttentionSync` only writes `fetch_failed` / health from window events. Auto-sync is fine (`dispatchOutcomeEvent`). A manual ingest or fetch throw leaves the health row on the last success and never opens Dashboard attention.

**Fix:** On those catch paths, `dispatchProviderSyncFailed` (or `*-sync-needs-reconnect` when `classifySyncFailure` is `expired`). Never emit `*-sync-completed`. Costco: ingest throw that is not auth is `failed` — do **not** `clearStoredTokens` / reconnect cooldown.

### G2 — Prefs lifecycle: lastRun first-read and `SIGNED_OUT`

`getAttention` / health / telemetry call `ensureLegacyKeysDeleted()`. Scheduler `shouldRun` (~309) does a namespaced `Preferences.get` without that, so unscoped `sync_lastRun_safeway` / `_costco` can linger until some other store reads.

`AuthContext.signOut()` calls `clearUserSyncState(uid)`. `onAuthStateChange('SIGNED_OUT')` only `setSyncUserId(null)` (~55). Session expiry / remote sign-out leaves that user's namespaced lastRun, attention, health, and telemetry on device. Second user does not *read* them (different key), but the brief required delete on sign-out, not only on the `signOut()` button.

**Fix:** Call `ensureLegacyKeysDeleted()` before every lastRun read/write. On `SIGNED_OUT`, `clearUserSyncState` with the **previous** uid (`getSyncUserId()` before nulling). Do not copy unscoped → namespaced.

### G3 — Safeway auth still uses substring `401` / `403`

`classifySyncFailure({ message: 'order 401123' })` is not `expired` (`CLASSIFIER_IGNORES_DIGITS_IN_MESSAGE_BODY`). `adaptSafewaySilentSync` and `handleFetchAuthError` still use `/401|403|unauthorized|forbidden/i.test(msg)`, so the same string becomes `needs_reconnect` + cooldown.

**Fix:** Use `classifySyncFailure({ status, reason, message }) === 'expired'` (numeric `status` 401/403 and allow-listed `reason` already count). Delete the digit-substring regex.

### G4 — `STATUS.SKIPPED` never returns to `IDLE`

Manual `_skipped` sets `STATUS.SKIPPED` and returns. Health row keys "Sync in progress" off that flag. After autosync finishes (`*-sync-completed|error|needs-reconnect`), the card still says in progress.

**Fix:** Listen for that provider's terminal window events and reset `SKIPPED` → `IDLE`. Do not persist skipped. Do not change the Connected pill.

### G5 — Login `startSync` bypasses the mapper

Silent paths map parse-all-dropped / unverified empty to `failed`. Safeway/Costco `startSync` (login) always dispatch `outcome: completed_items` after ingest, including empty parsed lists. That clears attention and can show "Synced 0 receipts".

**Fix:** After fetch+parse, run the mapper (Safeway: `fetchCompleted: true` only if `fetchSafewayReceipts` returned). `completed_empty` / `completed_items` / `failed` as in 01e. Parse-all-dropped → failed event, no completed.

### G6 — Manual completed does not write `sync_lastRun` (and Costco cooldown is incomplete)

Product table: `completed_empty` / `completed_items` write namespaced lastRun and **clear** that provider's reconnect cooldown. Only scheduler `dispatchOutcomeEvent` writes lastRun. Costco silent `completed_items` clears cooldown only inside successful `connectCostcoFromApp`. Manual success can be followed immediately by autosync; reconnect cooldown can remain.

**Fix:** Shared `writeLastRun(provider)` in `syncPrefKeys.js` (no-op if no uid; `ensureLegacyKeysDeleted` first). Call it from both hooks on completed_*. Always `clear*ReconnectCooldown` on completed_* (not only after connect-from-app). `skipped` / `failed` write neither.

---

## Technical Contract

### Phase 01e.g1 — Hook outcome contract (G1, G5, G6)

Files: [`useCostcoSync.js`](../../../frontend/src/hooks/useCostcoSync.js), [`useSafewaySync.js`](../../../frontend/src/hooks/useSafewaySync.js), [`syncPrefKeys.js`](../../../frontend/src/services/syncPrefKeys.js) (`writeLastRun` only).

```js
/** Write namespaced lastRun. No-op if getSyncUserId() is null. */
export async function writeLastRun(provider) { /* ensureLegacyKeysDeleted; Preferences.set */ }
```

- **Silent + login `catch`:** `dispatchProviderSyncFailed({ reason, message })` unless `classifySyncFailure` is `expired` → existing needs-reconnect event (Costco already dispatches `costco-sync-needs-reconnect` for mapper `needs_reconnect`; keep that). No completed event.
- **Costco silent ingest throw:** not expired → failed event; keep tokens; no cooldown change.
- **Safeway silent fetch throw:** if `handleFetchAuthError` did not clear tokens, failed event (today it `throw`s with no event).
- **Login `startSync` after fetch returns:** run `mapSafewaySilentToOutcome` / Costco equivalent (`_fromWebView` empty → `completed_empty`). Parse-all-dropped → failed. Do not hard-code `COMPLETED_ITEMS`.
- **On completed_* (silent and login):** `writeLastRun(provider)` then `clear*ReconnectCooldown`, then `dispatchProviderSyncCompleted` with `outcome`.

### Phase 01e.g2 — Prefs lifecycle (G2)

Files: [`useAppSyncScheduler.js`](../../../frontend/src/hooks/useAppSyncScheduler.js) `shouldRun` + lastRun write, [`AuthContext.jsx`](../../../frontend/src/contexts/AuthContext.jsx). Prefer calling `writeLastRun` from g1 instead of duplicating `Preferences.set`.

- `shouldRun`: `ensureLegacyKeysDeleted()` before `Preferences.get`.
- `onAuthStateChange`: if `_event === 'SIGNED_OUT'` (or `sess` has no user after a previous uid), `await clearUserSyncState(previousUid)` using `getSyncUserId()` **before** `setSyncUserId(null)`. Keep `signOut()` clearing as well (idempotent).

### Phase 01e.g3 — Classifier + skipped reset (G3, G4)

Files: `useAppSyncScheduler.js` `adaptSafewaySilentSync`, `useSafewaySync.js` `handleFetchAuthError`, both hooks for SKIPPED reset (or a 10-line helper).

- Replace `/401|403|.../` with `classifySyncFailure({ status: err?.status, message: err?.message }) === 'expired'`.
- When hook status is `SKIPPED`, subscribe once to `${provider}-sync-completed|error|needs-reconnect` and `setStatus(STATUS.IDLE)` if still skipped. Remove the listener on unmount / next `startSilent`.

---

## Logic Guardrails

- Do not invent outcomes. Mapper remains the only UI-outcome function.
- `skipped` writes neither lastRun nor cooldown.
- `failed` writes neither lastRun nor cooldown.
- Do not copy unscoped keys into namespaced keys.
- Do not treat substring `401`/`403` in a message as expired.
- Do not persist `STATUS.SKIPPED`.
- Do not render `err.message` in the health row or Dashboard attention (card alerts may keep existing copy).
- Do not change Providers "Connected" pill.
- Costco `{ receipts: [] }` without `_fromWebView` stays `failed`.

---

## Test-First Suite

Write tests **before** implementation. Names below are the DoD.

### 01e.g1

**`frontend/src/tests/useCostcoSync.test.js`**

- `SILENT_INGEST_THROW_EMITS_FAILED_NOT_COMPLETED` — `submitSilentReceipts` rejects `Network Error` → one `costco-sync-error` with `outcome: 'failed'`; zero `costco-sync-completed`; tokens not cleared
- `START_SYNC_EMPTY_FROM_WEBVIEW_IS_COMPLETED_EMPTY` — login path `{ receipts: [], _fromWebView: true }` with userId → completed event `outcome: completed_empty` (not `completed_items`); `writeLastRun` / lastRun key set

**`frontend/src/tests/useSafewaySync.test.js`**

- `SILENT_FETCH_THROW_EMITS_FAILED` — `fetchSafewayReceipts` rejects non-auth → `safeway-sync-error` `outcome: 'failed'`; no completed
- `START_SYNC_PARSE_ALL_DROPPED_EMITS_FAILED` — login fetch returns rows, parser returns null → failed event, no completed, no lastRun write

### 01e.g2

**`frontend/src/services/__tests__/syncPrefKeys.test.js`**

- `FIRST_LASTRUN_READ_DELETES_LEGACY_NOT_COPY` — seed `sync_lastRun_safeway`; `writeLastRun('safeway')` or `ensureLegacyKeysDeleted` via `shouldRun`; unscoped key gone; namespaced key does not contain the old timestamp unless a new completed write happened

**`frontend/src/hooks/__tests__/useAppSyncScheduler.test.js`**

- `SHOULD_RUN_DELETES_UNSCOPED_LASTRUN` — unscoped key present; namespaced empty; first `shouldRun` removes unscoped

**`frontend/src/tests/AuthContext.test.jsx`**

- `SIGNED_OUT_EVENT_CLEARS_SYNC_STATE` — after `getSession` user A, fire `onAuthStateChange('SIGNED_OUT', null)` → `clearUserSyncState` called with A's id

### 01e.g3

**`frontend/src/hooks/__tests__/useAppSyncScheduler.test.js`**

- `SAFEWAY_FETCH_ORDER_ID_401_IS_FAILED_NOT_RECONNECT` — fetch throws `Error('order 401123')` with no `status` → `safeway-sync-error` `outcome: 'failed'`; `setSafewayReconnectCooldown` **not** called

**`frontend/src/tests/useSafewaySync.test.js`** (or Costco equivalent)

- `SKIPPED_RESETS_TO_IDLE_ON_PROVIDER_TERMINAL_EVENT` — startSilent `_skipped` → `STATUS.SKIPPED`; dispatch `safeway-sync-completed` with `completed_empty` → `STATUS.IDLE`

**`frontend/src/components/__tests__/SafewayConnectCard.test.jsx`**

- Keep `RENDERS_SYNC_IN_PROGRESS_ON_SKIPPED_STATUS`. Do not assert in-progress after a completed event unless the hook still reports SKIPPED.

---

## Definition of Done

Verified 2026-09-08. **PASS**.

### 01e.g1

- [x] Manual silent ingest/fetch throw emits `*-sync-error` `outcome: 'failed'` (or needs-reconnect if expired); never completed — **PASS** (`SILENT_INGEST_THROW_EMITS_FAILED_NOT_COMPLETED`, `SILENT_FETCH_THROW_EMITS_FAILED`)
- [x] Login parse-all-dropped / Costco empty `_fromWebView` use mapper outcomes — **PASS** (`START_SYNC_PARSE_ALL_DROPPED_EMITS_FAILED`, `START_SYNC_EMPTY_FROM_WEBVIEW_IS_COMPLETED_EMPTY`)
- [x] Manual completed_* writes namespaced lastRun and clears reconnect cooldown — **PASS** (`writeLastRun` then `clear*ReconnectCooldown` then dispatch; `START_SYNC_EMPTY_FROM_WEBVIEW_IS_COMPLETED_EMPTY`, `SILENT_COMPLETED_ITEMS_CLEARS_COOLDOWN_WHEN_CONNECT_FROM_APP_FAILS`)
- [x] Named 01e.g1 tests pass — **PASS**

### 01e.g2

- [x] First lastRun read/write deletes unscoped lastRun keys (not copied) — **PASS** (`FIRST_LASTRUN_READ_DELETES_LEGACY_NOT_COPY`, `SHOULD_RUN_DELETES_UNSCOPED_LASTRUN`)
- [x] `SIGNED_OUT` (not only `signOut()`) clears that user's namespaced sync prefs — **PASS** (`SIGNED_OUT_EVENT_CLEARS_SYNC_STATE`)
- [x] Named 01e.g2 tests pass — **PASS**

### 01e.g3

- [x] Safeway fetch error `order 401123` is `failed`, not reconnect — **PASS** (`SAFEWAY_FETCH_ORDER_ID_401_IS_FAILED_NOT_RECONNECT`)
- [x] `STATUS.SKIPPED` returns to `IDLE` on that provider's terminal event — **PASS** (`SKIPPED_RESETS_TO_IDLE_ON_PROVIDER_TERMINAL_EVENT`)
- [x] Named 01e.g3 tests pass — **PASS**

### Logic Audit

| Guardrail | Evidence |
|---|---|
| Do not invent outcomes; mapper is the only UI-outcome function | `mapCostcoSilentToOutcome` / `mapSafewaySilentToOutcome` on silent + login `startSync` |
| `skipped` writes neither lastRun nor cooldown | `DOES_NOT_WRITE_LAST_RUN_ON_SKIPPED`; SKIPPED paths return before `writeLastRun` |
| `failed` writes neither lastRun nor cooldown | `DOES_NOT_WRITE_LAST_RUN_ON_ERROR_OUTCOME`; `START_SYNC_PARSE_ALL_DROPPED_EMITS_FAILED` asserts no `Preferences.set` |
| Do not copy unscoped keys into namespaced keys | `FIRST_LASTRUN_READ_DELETES_LEGACY_NOT_COPY`, `LEGACY_UNSCOPED_KEYS_ARE_DELETED_NOT_COPIED` |
| Do not treat substring `401`/`403` in a message as expired | `SAFEWAY_FETCH_ORDER_ID_401_IS_FAILED_NOT_RECONNECT`; `classifySyncFailure === 'expired'` in adapter, `handleFetchAuthError`, login token-clear |
| Do not persist `STATUS.SKIPPED` | React state only; reset `useEffect` in both hooks |
| Do not render `err.message` in the health row or Dashboard attention | Unchanged `SyncHealthRow.jsx` / `NeedsAttentionSection.jsx` enum copy |
| Do not change Providers "Connected" pill | `Providers.jsx` still `✓ Connected` / `Not Connected` |
| Costco `{ receipts: [] }` without `_fromWebView` stays `failed` | `COSTCO_EMPTY_WITHOUT_FROM_WEBVIEW_IS_FAILED` |
