# MVP Gap 01e — Import Reliability Surfaces

> **Superseded (07.2 / 07.3):** 01e.3 receipt stats UI host moved from Dashboard to Settings [`ReceiptSummarySection.jsx`](../../../frontend/src/components/ReceiptSummarySection.jsx). `GET /api/receipts/summary` unchanged. `Dashboard.jsx` deleted in 07.3.
>
> **Prerequisite:** Brief `01d-sync-feedback-surfaces.md` is complete. Costco/Safeway **fetch success-rate** work is a separate track.
>
> **Implementation review:** 2026-09-08 (initial 01e land). **Gap-closure review:** 2026-09-08 against [`01e-import-reliability-gaps.md`](01e-import-reliability-gaps.md) (G1–G6). Named 01e + 01e.g* tests pass (189 frontend in the 01e vitest set; 4 backend 01e.3). **01e.1 / 01e.2 / 01e.3 are PASS.**
>
> **Original scope:** Three sequential sub-phases. **01e.1** fetch-completed outcome contract (frontend). **01e.2** per-store health row + `fetch_failed` attention (frontend). **01e.3** Dashboard receipt stats (backend + Dashboard).
>
> **Do NOT touch in 01e.1:** `SafewayConnectCard.jsx`, `CostcoOneTapSync.jsx` (except tests that already assert hook status), `Dashboard.jsx`, `NeedsAttentionSection.jsx`, `webViewBridge.js`, provider bridges, any backend file, pantry/cook-loop.
>
> **Do NOT touch in 01e.2:** backend, Dashboard stat cards, Providers "Connected" pill, `webViewBridge.js`.
>
> **Do NOT touch in 01e.3:** scheduler, classifiers, store cards, attention store.

| Sub-phase | Verdict | Notes |
|---|---|---|
| 01e.1 | **PASS** | Mapper, classifier, namespaced prefs, scheduler + hook catch/login outcomes, `writeLastRun`, `SIGNED_OUT` clear, classifier-wired Safeway auth. Closed by 01e.g1–g3 (gaps G1, G2, G3, G5, G6). |
| 01e.2 | **PASS** | Health row, `fetch_failed` attention, remount-safe toasts, write-then-cache persist. Hook catch emits `*-sync-error`; `STATUS.SKIPPED` resets to `IDLE` on that provider's terminal event (G1, G4). |
| 01e.3 | **PASS** | Lean `GET /api/receipts/summary` + "Your receipts" UI (Settings since 07.2). |

---

## Objective

Make receipt-import **failure visible and recoverable**. Zero new receipts is not an error. "Needs attention" only when the fetch failed or could not complete. The Dashboard must show real receipt totals (not hardcoded `$0` / `0`). Each connected store must show last attempt + outcome.

This is **not** "make Costco/Safeway fetch work."

---

## Product rules (locked)

A zero-length receipt list is `completed_empty` **only** when the provider returned a **terminal success response**. Timeout, closed-early, `[]` without a finished fetch, `_tokensOnly`, or parse-all-dropped is `failed`.

Do **not** invent a sixth classifier. Map existing Costco/Safeway kinds through **one** mapper (`syncOutcomeMapper.js`). Keep window event **names** (`*-sync-completed|needs-reconnect|error|skipped`). Put the UI outcome on `event.detail.outcome`.

Two cooldowns stay distinct:

- `sync_lastRun_<provider>_<userId>` — 4-hour auto-sync throttle
- `<provider> reconnect cooldown` (existing bridge helpers) — reconnect-prompt suppression

`skipped` writes **neither**.

| Outcome | Requires | Health row (01e.2) | Attention store | `sync_lastRun` | reconnect cooldown |
|---|---|---|---|---|---|
| `completed_empty` | Terminal success; 0 receipts after parse | "No new receipts" | **clear all kinds** | write | **clear** |
| `completed_items` | Terminal success; ≥1 receipt | "Synced N receipts" | **clear all kinds** | write | **clear** |
| `failed` | Timeout, closed-early, `[]` without terminal success, `_tokensOnly`, parse-all-dropped, ingest throw that is not auth | "Couldn't sync" | set `fetch_failed` | **no write** | **no change** |
| `needs_reconnect` | Auth/session expired | "Reconnect needed" | set `needs_reconnect` | no write | **set** (existing terminal-reason rules) |
| `skipped` | Throttle, mutex busy, reconnect cooldown | "Sync in progress" (manual tap) or unchanged (auto) | **no change** | no write | no write |

Copy is enum-mapped. Never render `err.message` in the health row or Dashboard attention.

Dashboard stats (01e.3) are **per signed-in user**. Label **Your receipts**. Pantry remains household-scoped. Household receipt dedup stays deferred ([`household-sharing-open-items.md`](../household-sharing-open-items.md)).

---

## Technical Contract

### Shared constants — `frontend/src/services/syncOutcomeMapper.js` (new in 01e.1)

```js
export const SYNC_OUTCOMES = {
  COMPLETED_EMPTY: 'completed_empty',
  COMPLETED_ITEMS: 'completed_items',
  FAILED: 'failed',
  NEEDS_RECONNECT: 'needs_reconnect',
  SKIPPED: 'skipped',
};

/**
 * @param {object|null|undefined} result - startSilentSync() return value
 * @returns {{ outcome: string, receipts: object[], reason?: string }}
 */
export function mapCostcoSilentToOutcome(result) { /* ... */ }

/**
 * @param {object|null|undefined} result - startSilentSync() return value
 * @param {{ rawCount: number, parsedCount: number, fetchCompleted: boolean }} fetch
 * @returns {{ outcome: string, reason?: string }}
 */
export function mapSafewaySilentToOutcome(result, fetch) { /* ... */ }
```

**Costco `mapCostcoSilentToOutcome`** — call existing `classifyCostcoSilentResult` first, then:

| `classifyCostcoSilentResult` | Extra | UI outcome | `reason` |
|---|---|---|---|
| `skipped` | — | `skipped` | `result.reason` |
| `needs_reconnect` | — | `needs_reconnect` | `result.reason` |
| `timeout` (`!result`) | — | `failed` | `silent_timeout` |
| `tokens_only` | — | `failed` | `tokens_only` |
| `synced` | `result._fromWebView === true` and `Array.isArray(result.receipts)` and `receipts.length === 0` | `completed_empty` | — |
| `synced` | `_fromWebView === true` and `receipts.length > 0` | `completed_items` | — |
| `synced` | missing `_fromWebView` (including `{ receipts: [] }` alone) | `failed` | `fetch_incomplete` |

**Safeway `mapSafewaySilentToOutcome`** — classify extract first (`classifySafewaySilentResult`):

| Extract kind | Fetch args | UI outcome | `reason` |
|---|---|---|---|
| `skipped` / `needs_reconnect` / `timeout` / `error` | (fetch not run) | same mapping as Costco (`error` → `failed`, `reason: missing_club_card`) | as today |
| `synced` | `fetchCompleted !== true` | `failed` | `fetch_incomplete` |
| `synced` | `fetchCompleted` and `rawCount > 0` and `parsedCount === 0` | `failed` | `parse_all_dropped` |
| `synced` | `fetchCompleted` and `parsedCount === 0` | `completed_empty` | — |
| `synced` | `fetchCompleted` and `parsedCount > 0` | `completed_items` | — |

`fetchCompleted` is true only when `fetchSafewayReceipts` **returned** (did not throw).

---

### Phase 01e.1 — Fetch-completed contract

#### 1. Mapper + Costco/Safeway classify files (modified)

Do not change the **return strings** of `classifyCostcoSilentResult` / `classifySafewaySilentResult`. Adapters and `useCostcoSync` call the mapper **after** classify.

Update [`useCostcoSync.js`](../../../frontend/src/hooks/useCostcoSync.js) only as needed to keep compiling against the new modules (it already has `STATUS.SKIPPED` and empty-success). **Change** `test_startSilent_sets_success_when_empty_receipts_array`: `{ receipts: [] }` without `_fromWebView` must be `STATUS.ERROR` / `failed`, not success. `{ receipts: [], _fromWebView: true }` remains success / `completed_empty`.

#### 2. `frontend/src/hooks/useAppSyncScheduler.js` (modified)

Replace adapter return `'synced'` / `'error'` with mapper UI outcomes (`completed_empty` | `completed_items` | `failed` | existing `skipped` / `needs_reconnect`).

- **Remove** `clearSafewayReconnectCooldown()` from the empty-receipts branch (~line 82) and the Costco empty `'synced'` return (~line 171). Clear cooldown **only** in `dispatchOutcomeEvent` for `completed_empty` / `completed_items`.
- Costco empty without `_fromWebView` → `failed` (no lastRun, no cooldown clear).
- Safeway: if `raw.length > 0` and parsed length `=== 0` → `failed` (`parse_all_dropped`). If fetch throws non-auth → `failed`. Auth throw → `needs_reconnect` (existing).
- `dispatchOutcomeEvent`:
  - `completed_empty` / `completed_items` → `*-sync-completed` with `detail: { tier, receipts_stored, items_added, outcome }`; write namespaced lastRun; **clear** that provider's reconnect cooldown
  - `failed` → `*-sync-error` with `detail: { message, reason, outcome: 'failed' }`; **no** lastRun; **no** cooldown change
  - `skipped` / `needs_reconnect` unchanged (no lastRun)
- `shouldRun` reads namespaced lastRun via `syncPrefKeys`.

Keep dispatching `completed` only for the two completed outcomes so 01d `clearProvider` on `*-sync-completed` stays correct **once empty-unverified no longer emits completed**.

#### 3. `frontend/src/services/providerSyncEvents.js` (modified)

```js
export function dispatchProviderSyncCompleted(provider, { tier, receipts_stored, items_added, outcome }) {
  window.dispatchEvent(new CustomEvent(`${provider}-sync-completed`, {
    detail: { tier, receipts_stored, items_added, outcome },
  }));
}

export function dispatchProviderSyncFailed(provider, { reason, message }) {
  window.dispatchEvent(new CustomEvent(`${provider}-sync-error`, {
    detail: { reason, message, outcome: 'failed' },
  }));
}
```

Forward `outcome` on completed. Today the Costco hook passes `outcome` but the helper **drops** it.

#### 4. `frontend/src/hooks/useSafewaySync.js` (modified)

Mirror Costco: `STATUS.SKIPPED` on `_skipped` (not `STATUS.IDLE`). Use `mapSafewaySilentToOutcome` after extract + fetch. `completed_empty` only when fetch returned. Parse-all-dropped → error + `dispatchProviderSyncFailed`. Include `outcome` on completed events. Do not clear reconnect cooldown on unverified empty.

#### 5. `frontend/src/services/syncPrefKeys.js` (new) + AuthContext (modified)

[`AuthContext.jsx`](../../../frontend/src/contexts/AuthContext.jsx) already calls these. Implement:

```js
export function setSyncUserId(userId) { /* module-level current user */ }
export function lastRunKey(provider) { /* sync_lastRun_${provider}_${userId} */ }
export function attentionKey() { /* sync_attention_${userId} */ }
export function telemetryKey(provider) { /* sync_telemetry_${provider}_${userId} */ }
/** Delete namespaced keys for this user. Also delete unscoped legacy keys. */
export async function clearUserSyncState(userId) { /* ... */ }
```

If `userId` is null, key helpers must not read/write (scheduler already no-ops without uid).

**On session:** `setSyncUserId(sess?.user?.id ?? null)` in `getSession` and `onAuthStateChange` (today only sign-out clears it).

**Legacy keys** (unscoped): `sync_lastRun_safeway`, `sync_lastRun_costco`, `sync_attention`, `sync_telemetry_safeway`, `sync_telemetry_costco`. **Delete on first namespaced read / on sign-out. Do not copy into the new keys** (copying would attach user A's history to whoever logs in first after upgrade).

Wire [`providerAttentionStore.js`](../../../frontend/src/services/providerAttentionStore.js) `PREF_KEY` through `attentionKey()`, [`useAppSyncScheduler.js`](../../../frontend/src/hooks/useAppSyncScheduler.js) lastRun through `lastRunKey()`, [`syncTelemetry.js`](../../../frontend/src/services/syncTelemetry.js) through `telemetryKey()`. If `getSyncUserId()` is null, skip persist (in-memory only / no-op write).

#### 6. `frontend/src/services/syncOutcomeClassifier.js` (new)

Move **structured** classification here. Leaf module — no React imports.

```js
/**
 * @param {{ reason?: string, status?: number, message?: string }} input
 * @returns {'expired' | 'transient' | 'unknown'}
 */
export function classifySyncFailure({ reason, status, message } = {}) { /* ... */ }

/** @deprecated wrapper: classifySyncFailure({ message }) */
export function classifyError(message) {
  return classifySyncFailure({ message });
}
```

Rules:

- `status === 401` or `status === 403` → `expired`
- `reason` in an allow-list (`token_expired`, `invalid_grant`, `needs_reconnect`, `refresh_invalid_grant`, … existing terminal Costco/Safeway reasons) → `expired`
- `message` / `reason` matching **whole-token** network words (`network`, `timeout`, `offline`, …) → `transient`
- A message that merely **contains digits** `401` / `403` (e.g. order id `401123`) is **not** expired

[`ReconnectBanner.jsx`](../../../frontend/src/components/ReconnectBanner.jsx) re-exports `classifyError` for one release. [`useProviderAttentionSync.js`](../../../frontend/src/hooks/useProviderAttentionSync.js) and [`SyncToastHost.jsx`](../../../frontend/src/components/SyncToastHost.jsx) import from the leaf (or keep `classifyError` re-export). Prefer `detail.reason` / `detail.outcome` over parsing `detail.message` when present: `outcome === 'failed'` is never reconnect; `outcome === 'needs_reconnect'` is reconnect.

`useProviderAttentionSync` **onCompleted:** `clearProvider` only when `e.detail?.outcome` is `completed_empty` or `completed_items`. Missing `outcome` (old events): do **not** clear (fail closed). 01e.1 emitters always send `outcome`.

---

### Phase 01e.2 — Health row (blocked on 01e.1 namespaced prefs)

#### 7. Persist last attempt — extend attention store **or** sibling `syncHealthStore.js`

Per provider, namespaced by user:

```js
/** @typedef {{ lastAttemptAt: number, lastOutcome: string, lastCompletedAt: number | null, receiptsStored: number, lastToastedOutcome: string | null }} HealthRecord */
```

Write on **every** terminal mapper outcome including `failed` / `needs_reconnect` / completed. Do **not** persist `skipped` (in-flight). `lastAttemptAt` = now on those writes. `lastCompletedAt` updates only on completed_* .

Validate on read: drop unknown provider keys and unknown `lastOutcome` / `kind` values.

#### 8. `providerAttentionStore.js` (modified)

- `AttentionItem.kind`: `'needs_reconnect' | 'fetch_failed'`
- `setFetchFailed(provider)` / existing `setNeedsReconnect` / `clearProvider`
- `persist()`: `Preferences.set` **first**; assign `cache` and `notify()` **only on success**. Do not swallow write rejection in `enqueue` (`writeQueue.then(run, run)` must not hide failure from the caller)
- `lastToastedOutcome` lives on the health record (or attention item). [`SyncToastHost.jsx`](../../../frontend/src/components/SyncToastHost.jsx) reads/writes that field instead of `lastOutcomeRef`

01d toast rules still apply: toast `completed_items` when `items_added > 0`; no toast on `completed_empty`; edge-trigger reconnect and failed.

`useProviderAttentionSync`: `*-sync-error` with `outcome === 'failed'` (and not expired) → `setFetchFailed`. Expired / `needs-reconnect` → `setNeedsReconnect`. Completed_* → `clearProvider`.

#### 9. Store cards

[`SafewayConnectCard.jsx`](../../../frontend/src/components/SafewayConnectCard.jsx) and [`CostcoOneTapSync.jsx`](../../../frontend/src/components/CostcoOneTapSync.jsx), below the sync buttons, muted text from the health record:

- `completed_empty` — `No new receipts · Last synced {formatDistanceToNowStrict(lastCompletedAt)} ago`
- `completed_items` — `Synced {n} receipts · Last synced …`
- `failed` — `Couldn't sync · Last tried …`
- `needs_reconnect` — `Reconnect needed`
- Hook `STATUS.SKIPPED` — `Sync in progress` (session only; not persisted)
- No record — render nothing

Use `date-fns` `formatDistanceToNowStrict` (already a dependency). `PROVIDER_LABELS` for store names. Do **not** change the Providers "Connected" pill.

#### 10. `NeedsAttentionSection.jsx` (modified)

Show `fetch_failed` rows as well as `needs_reconnect`. Copy: "{Store} couldn't sync" + CTA `Link` to `/providers` (not "Reconnect" for fetch_failed — button label **Try again** / **Open stores**). Session-dismiss still keyed on `updatedAt`. Never print `err.message`.

---

### Phase 01e.3 — Dashboard stats (independent)

Do **not** call `api.getReceipts` from Dashboard — [`get_user_receipts`](../../../backend/services/supabase_service.py) uses `.select("*")` and includes `raw_data`.

#### 11. `SupabaseService.get_user_receipt_summary`

```python
def get_user_receipt_summary(
    self, user_id: str, *, today: Optional[date] = None
) -> Dict[str, Any]:
```

Query `receipts` with **explicit columns only**: `id, provider, order_date, total_amount, num_items`. Never `raw_data`. Aggregate in Python:

- `total_receipts`: row count
- `month_spend`: sum of `total_amount` where `order_date` is in the UTC calendar month of `today` (default `date.today()`)
- `total_items`: sum of `num_items`
- `recent`: up to 5 rows, `order_date` desc, same lean columns

No new migration unless the implementer hits a hard row-limit; friends-beta volume is fine in-process.

#### 12. `GET /api/receipts/summary`

Same auth as `GET /api/receipts` (`get_user_id_from_request()`, ignore forged query `user_id`). 401 without user. 503 if no supabase service.

Response:

```json
{
  "total_receipts": 0,
  "month_spend": 0,
  "total_items": 0,
  "recent": []
}
```

`month_spend` is a number (not a formatted string).

#### 13. `frontend/src/services/apiClient.js` + [`Dashboard.jsx`](../../../frontend/src/pages/Dashboard.jsx)

`api.getReceiptSummary(userId)` → that endpoint.

Replace the three hardcoded cards (`0` / `$0.00` / `0`) with summary fields. Heading **Your receipts**. Format spend as currency in the UI.

Wire `recent` into the existing Recent Receipts list (still user-scoped). Pull-to-refresh calls the summary endpoint (remove the fake `setTimeout`). Keep pantry search as-is.

---

## Logic Guardrails

- **Empty list ≠ success** unless terminal success is proven (`_fromWebView` on Costco; `fetchSafewayReceipts` returned on Safeway).
- **Parse-all-dropped is `failed`**, not `completed_empty` (Safeway: `rawCount > 0 && parsedCount === 0`). Costco parse-all-dropped without a raw count is indistinguishable from empty `_fromWebView`; treat `_fromWebView` + empty array as `completed_empty` (do not change `webViewBridge.js` in this brief).
- **Do not clear reconnect cooldown** except on `completed_empty` / `completed_items`.
- **Do not write `sync_lastRun`** except on those two outcomes. `skipped` and `failed` must not start the 4-hour throttle.
- **`*-sync-completed` must not fire** for unverified empty or failed fetches (that would clear 01d reconnect attention).
- **Prefs are user-scoped.** Sign-out deletes that user's namespaced keys + leftover unscoped keys. Second user must not inherit attention, lastRun, or telemetry.
- **Do not migrate unscoped → namespaced** (privacy). Delete unscoped.
- **`classifySyncFailure` must not treat substring `401`/`403` in a message as expired.** Use `status` or allow-listed `reason`.
- **No `err.message` in UI.** Health row and attention copy are fixed strings.
- **`persist()` write-then-cache.** Failed Preferences write must not update memory or notify listeners.
- **Manual `_skipped` is visible** (`STATUS.SKIPPED` / "Sync in progress"), not `IDLE` and not `ERROR`.
- **Dashboard must not fetch `raw_data`.** Summary columns only.
- **Dashboard totals are the signed-in user's receipts**, labeled "Your receipts."
- **No parallel outcome vocabulary.** Mapper is the only UI-outcome function; classify* stay provider-internal.
- **Providers Connected pill unchanged.**

---

## Test-First Suite

Write tests **before** implementation. Names below are the DoD.

### 01e.1

**`frontend/src/services/__tests__/syncOutcomeMapper.test.js` (new)**

- `COSTCO_EMPTY_FROM_WEBVIEW_IS_COMPLETED_EMPTY` — `{ receipts: [], _fromWebView: true }`
- `COSTCO_EMPTY_WITHOUT_FROM_WEBVIEW_IS_FAILED` — `{ receipts: [] }`
- `COSTCO_TOKENS_ONLY_IS_FAILED`
- `COSTCO_NULL_IS_FAILED_TIMEOUT`
- `COSTCO_SKIPPED_PASSTHROUGH`
- `SAFEWAY_PARSE_ALL_DROPPED_IS_FAILED` — extract synced + `{ rawCount: 3, parsedCount: 0, fetchCompleted: true }`
- `SAFEWAY_FETCH_RETURNED_EMPTY_IS_COMPLETED_EMPTY` — `{ rawCount: 0, parsedCount: 0, fetchCompleted: true }`
- `SAFEWAY_FETCH_NOT_COMPLETED_IS_FAILED`

**`frontend/src/services/__tests__/syncOutcomeClassifier.test.js` (new)**

- `CLASSIFIER_IGNORES_DIGITS_IN_MESSAGE_BODY` — `{ message: 'order 401123' }` → not `expired`
- `CLASSIFIER_STATUS_401_IS_EXPIRED`
- `CLASSIFIER_ALLOWLISTED_REASON_IS_EXPIRED` — `{ reason: 'invalid_grant' }`

**`frontend/src/services/__tests__/syncPrefKeys.test.js` (new)**

- `SIGN_OUT_CLEARS_SYNC_STATE` — namespaced lastRun/attention/telemetry removed
- `SECOND_USER_DOES_NOT_INHERIT_ATTENTION` — user B `getAttention()` empty after A wrote and signed out
- `LEGACY_UNSCOPED_KEYS_ARE_DELETED_NOT_COPIED`

**`frontend/src/hooks/__tests__/useAppSyncScheduler.test.js` (extend)**

- `EMPTY_WITHOUT_TERMINAL_RESPONSE_DOES_NOT_CLEAR_COOLDOWN` — Costco `{ receipts: [] }` → no `clearCostcoReconnectCooldown`; no `sync_lastRun_costco_` write; `costco-sync-error` not `completed`
- `COMPLETED_EMPTY_FROM_WEBVIEW_WRITES_LASTRUN` — `{ receipts: [], _fromWebView: true }` → lastRun write + cooldown clear + `completed` with `outcome: completed_empty`
- Update `WRITES_SYNC_LAST_RUN_ON_SYNCED_OUTCOME` to namespaced key + completed_* outcomes

**`frontend/src/hooks/__tests__/useProviderAttentionSync.test.js` (extend)**

- `EMPTY_UNVERIFIED_RESULT_DOES_NOT_CLEAR_RECONNECT` — `*-sync-completed` without `outcome` (or with garbage) does not `clearProvider`
- `COMPLETED_EMPTY_CLEARS_RECONNECT` — `outcome: completed_empty` does clear

**`frontend/src/tests/useCostcoSync.test.js` (fix + keep)**

- Keep `MANUAL_TAP_DURING_AUTOSYNC_SHOWS_IN_PROGRESS` (`STATUS.SKIPPED`)
- Change empty-without-flag case from success to failed
- Add `_fromWebView` empty → success / completed event with `outcome: completed_empty`

**`frontend/src/tests/useSafewaySync.test.js` (extend)**

- Skip → `STATUS.SKIPPED` not `IDLE`
- Fetch returned `[]` → completed_empty on the event detail
- Raw rows all parse-fail → error + failed event, no completed

**`frontend/src/services/__tests__/providerSyncEvents.test.js` (extend)**

- Completed helper forwards `outcome`
- `dispatchProviderSyncFailed` emits `*-sync-error` with `outcome: 'failed'`

### 01e.2

**`frontend/src/services/__tests__/providerAttentionStore.test.js` (extend)**

- `FAILED_WRITE_DOES_NOT_DESYNC_CACHE` — mock `Preferences.set` reject; cache unchanged
- `UNKNOWN_PERSISTED_KEYS_ARE_DROPPED` — extra provider / bad `kind` omitted from `getAttention()`
- `SET_FETCH_FAILED_KIND`

**`frontend/src/components/__tests__/SyncToastHost.test.jsx` (extend)**

- `NO_REPEAT_TOAST_AFTER_REMOUNT` — same `failed` / `needs_reconnect` after unmount+remount does not toast again (uses persisted `lastToastedOutcome`)

**`frontend/src/components/__tests__/NeedsAttentionSection.test.jsx` (extend)**

- Shows fetch_failed row with stores CTA, not reconnect-only filter
- Dismiss session behavior unchanged (`updatedAt`)

**`frontend/src/components/__tests__/SafewayConnectCard.test.jsx` and Costco equivalent (extend)**

- `RENDERS_LAST_SYNC_AT_WHEN_HEALTH_PRESENT`
- `RENDERS_NO_NEW_RECEIPTS_ON_COMPLETED_EMPTY`
- `RENDERS_SYNC_IN_PROGRESS_ON_SKIPPED_STATUS`
- `HIDES_HEALTH_WHEN_NO_RECORD`

### 01e.3

**`tests/backend/test_services/test_supabase_service.py`**

- `test_get_user_receipt_summary_excludes_raw_data` — captured select string has no `raw_data` and is not `*`
- `test_get_user_receipt_summary_month_spend_uses_today` — `today=date(2026, 9, 15)` sums only September rows

**`tests/backend/test_routes/test_receipts.py`** (new or extend area1)

- Unauthenticated GET `/api/receipts/summary` → 401
- Forged `user_id` query ignored (same pattern as `GET /api/receipts`)

**Dashboard vitest** (new `frontend/src/tests/Dashboard.test.jsx` or extend `features.test.jsx`)

- Cards render summary values from `getReceiptSummary`
- Heading includes "Your receipts"
- Empty summary shows zeros from API, not literals left in JSX after load
- Refresh calls summary again

---

## Definition of Done

Reviewed 2026-09-08 (initial) and re-verified 2026-09-08 after [`01e-import-reliability-gaps.md`](01e-import-reliability-gaps.md). **PASS** | **PARTIAL** | **FAIL**.

### 01e.1

- [x] `syncOutcomeMapper.js`, `syncPrefKeys.js`, `syncOutcomeClassifier.js` exist; Costco/AuthContext imports resolve — **PASS**
- [x] `{ receipts: [] }` without `_fromWebView` is `failed`; with `_fromWebView` is `completed_empty` — **PASS** (mapper + silent hook + scheduler + login `startSync`)
- [x] Empty unverified fetch does not write lastRun, does not clear reconnect cooldown, does not emit `*-sync-completed` — **PASS** (`EMPTY_WITHOUT_TERMINAL_RESPONSE_DOES_NOT_CLEAR_COOLDOWN`)
- [x] Prefs keys include user id; sign-out clears; unscoped keys deleted not copied — **PASS** — `writeLastRun` / `shouldRun` call `ensureLegacyKeysDeleted`; `onAuthStateChange('SIGNED_OUT')` calls `clearUserSyncState(previousUid)` before `setSyncUserId(null)` (`FIRST_LASTRUN_READ_DELETES_LEGACY_NOT_COPY`, `SHOULD_RUN_DELETES_UNSCOPED_LASTRUN`, `SIGNED_OUT_EVENT_CLEARS_SYNC_STATE`)
- [x] `classifySyncFailure` ignores `401` digits inside an order id — **PASS** — leaf classifier + `adaptSafewaySilentSync` + `handleFetchAuthError` + login token-clear use `classifySyncFailure === 'expired'` (`CLASSIFIER_IGNORES_DIGITS_IN_MESSAGE_BODY`, `SAFEWAY_FETCH_ORDER_ID_401_IS_FAILED_NOT_RECONNECT`)
- [x] `clearProvider` only on completed_* `outcome` — **PASS**
- [x] Manual Costco/Safeway `_skipped` → `STATUS.SKIPPED` — **PASS** — status is set; resets to `IDLE` on that provider's `*-sync-completed|error|needs-reconnect` (`SKIPPED_RESETS_TO_IDLE_ON_PROVIDER_TERMINAL_EVENT`)
- [x] Named 01e.1 tests pass; existing scheduler / Costco / Safeway / attention suites updated — **PASS** (vitest 2026-09-08, including 01e.g* names)

### 01e.2

- [x] Health row on both store cards; skipped in-progress copy; no Connected-pill change — **PASS** — rows + copy + pill; `STATUS.SKIPPED` shows "Sync in progress" then returns to `IDLE` so the copy cannot outlive the other sync (`RENDERS_SYNC_IN_PROGRESS_ON_SKIPPED_STATUS`, `SKIPPED_RESETS_TO_IDLE_ON_PROVIDER_TERMINAL_EVENT`). `Providers.jsx` still `✓ Connected` / `Not Connected`
- [x] Dashboard attention includes `fetch_failed` — **PASS** — mapper-classified silent failures and hook `catch` / login `startSync` failures emit `*-sync-error` `outcome: 'failed'` (`SILENT_INGEST_THROW_EMITS_FAILED_NOT_COMPLETED`, `SILENT_FETCH_THROW_EMITS_FAILED`, `START_SYNC_PARSE_ALL_DROPPED_EMITS_FAILED`)
- [x] Toasts do not repeat after remount — **PASS** (`NO_REPEAT_TOAST_AFTER_REMOUNT`)
- [x] `persist()` cannot desync cache on write failure — **PASS** (`FAILED_WRITE_DOES_NOT_DESYNC_CACHE`)
- [x] Named 01e.2 tests pass — **PASS**

### 01e.3

- [x] `GET /api/receipts/summary` returns aggregates; select list never includes `raw_data` — **PASS**
- [x] Dashboard cards and recent list use that payload; labeled Your receipts — **PASS**
- [x] Named 01e.3 tests pass — **PASS** (2 service + 2 route pytest; Dashboard vitest)

### Logic Audit

| Guardrail | Evidence | Status |
|---|---|---|
| Empty list ≠ success unless terminal proven | `COSTCO_EMPTY_WITHOUT_FROM_WEBVIEW_IS_FAILED`, `SAFEWAY_FETCH_NOT_COMPLETED_IS_FAILED`, `EMPTY_WITHOUT_TERMINAL_RESPONSE_DOES_NOT_CLEAR_COOLDOWN`, `START_SYNC_EMPTY_FROM_WEBVIEW_IS_COMPLETED_EMPTY` | **PASS** (silent + login `startSync` via mapper) |
| Parse-all-dropped is `failed` | `SAFEWAY_PARSE_ALL_DROPPED_IS_FAILED`, `test_startSilent_parse_all_dropped_emits_failed_not_completed`, `START_SYNC_PARSE_ALL_DROPPED_EMITS_FAILED` | **PASS** (silent + login) |
| Clear reconnect cooldown only on completed_* | Scheduler `dispatchOutcomeEvent` → `clearProviderReconnectCooldown` only in completed cases (`useAppSyncScheduler.js`). Hooks: `writeLastRun` then `clear*ReconnectCooldown` then dispatch on every completed_* (including Costco when `connectCostcoFromApp` rejects). Empty unverified: `EMPTY_WITHOUT_TERMINAL_RESPONSE_DOES_NOT_CLEAR_COOLDOWN`. `SILENT_COMPLETED_ITEMS_CLEARS_COOLDOWN_WHEN_CONNECT_FROM_APP_FAILS` | **PASS** |
| Write `sync_lastRun` only on completed_* | Shared `writeLastRun` from scheduler + both hooks; `DOES_NOT_WRITE_LAST_RUN_ON_ERROR_OUTCOME` / `_SKIPPED` / `_NEEDS_RECONNECT`; `START_SYNC_EMPTY_FROM_WEBVIEW_IS_COMPLETED_EMPTY` writes namespaced lastRun; parse-all-dropped asserts no lastRun | **PASS** |
| `*-sync-completed` must not fire for unverified empty or failed | `EMPTY_WITHOUT_TERMINAL_RESPONSE_DOES_NOT_CLEAR_COOLDOWN`; Costco empty-without-flag → `STATUS.ERROR`; catch paths emit `*-sync-error` not completed (`SILENT_INGEST_THROW_EMITS_FAILED_NOT_COMPLETED`, `SILENT_FETCH_THROW_EMITS_FAILED`) | **PASS** |
| Prefs user-scoped; sign-out deletes namespaced + leftover unscoped; no migrate | `SIGN_OUT_CLEARS_SYNC_STATE`, `SECOND_USER_DOES_NOT_INHERIT_ATTENTION`, `LEGACY_UNSCOPED_KEYS_ARE_DELETED_NOT_COPIED`, `FIRST_LASTRUN_READ_DELETES_LEGACY_NOT_COPY`, `SHOULD_RUN_DELETES_UNSCOPED_LASTRUN`, `SIGNED_OUT_EVENT_CLEARS_SYNC_STATE` | **PASS** |
| `classifySyncFailure` must not treat substring `401`/`403` as expired | `CLASSIFIER_IGNORES_DIGITS_IN_MESSAGE_BODY`, `SAFEWAY_FETCH_ORDER_ID_401_IS_FAILED_NOT_RECONNECT`; adapter + `handleFetchAuthError` + login token-clear use `classifySyncFailure === 'expired'` | **PASS** |
| No `err.message` in health row or Dashboard attention | `SyncHealthRow.jsx` enum copy; `NeedsAttentionSection.jsx` fixed strings | **PASS** |
| `persist()` write-then-cache | `FAILED_WRITE_DOES_NOT_DESYNC_CACHE`; `providerAttentionStore.js` persist assigns cache after `Preferences.set` | **PASS** |
| Manual `_skipped` visible (`STATUS.SKIPPED` / "Sync in progress") | `MANUAL_TAP_DURING_AUTOSYNC_SHOWS_IN_PROGRESS`, `RENDERS_SYNC_IN_PROGRESS_ON_SKIPPED_STATUS`, `SKIPPED_RESETS_TO_IDLE_ON_PROVIDER_TERMINAL_EVENT` | **PASS** |
| Dashboard must not fetch `raw_data` | `test_get_user_receipt_summary_excludes_raw_data`; Dashboard calls `getReceiptSummary` only | **PASS** |
| Dashboard totals are the signed-in user's; label "Your receipts" | Route uses `get_user_id_from_request()`; `HEADING_INCLUDES_YOUR_RECEIPTS`; forged `user_id` ignored | **PASS** |
| Mapper is the only UI-outcome function | `syncOutcomeMapper.js`; classify* unchanged; login `startSync` calls `mapCostcoSilentToOutcome` / `mapSafewaySilentToOutcome` | **PASS** |
| Providers Connected pill unchanged | `Providers.jsx` still `✓ Connected` / `Not Connected` | **PASS** |

---

## Explicit non-goals

- Costco/Safeway login or extract success rate
- Receipts stored but pantry processing failed (Providers "Some issues")
- Household leave/merge / household-scoped receipt dedup
- Cook-loop, bridge copy
- A new outcome enum besides `SYNC_OUTCOMES`
- Rendering raw provider error strings
- Changing 01d listen-vs-toast mount points (`AppRoutes` vs `AppShell`)
