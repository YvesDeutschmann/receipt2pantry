# Silent Sync Phase 1 -- Foundation

> **Prerequisite:** Read `docs/implementation_briefs/silent_sync/README.md` (if present) and the master plan at `.cursor/plans/tiered_silent_sync_*.plan.md`.
>
> **Scope:** Four new frontend modules plus one additive extension to `tokenStorage.js`. Zero production wiring. No behavior change to any existing feature.
>
> **Do NOT touch in this phase:** `webViewBridge.js`, `safewayWebViewBridge.js`, `costcoWebViewBridge.js`, any React component, any hook, any backend file.

---

## Objective

Establish the shared utilities and observability substrate that later phases plug into. Everything built here must be fully unit-tested and have zero production callers at the end of this phase. The codebase after Phase 1 must behave identically to `main` for any end user.

---

## Technical Contract

### 1. `frontend/src/services/jwtUtils.js` (new)

Extract the two pure helpers currently in [frontend/src/services/costcoNativeSync.js](../../../frontend/src/services/costcoNativeSync.js) lines 8-38 into a shared module.

```js
/**
 * Decode a JWT payload without signature verification.
 * @param {string|null|undefined} token
 * @returns {object} Payload object, or {} if decoding fails.
 */
export function decodeJwtPayload(token) { /* ... */ }

/**
 * Check if the token is expired or will expire within bufferSeconds.
 * @param {string|null|undefined} token
 * @param {number} [bufferSeconds=60]
 * @returns {boolean} true if expired, missing exp, malformed, or null.
 */
export function isTokenExpired(token, bufferSeconds = 60) { /* ... */ }
```

Update [frontend/src/services/costcoNativeSync.js](../../../frontend/src/services/costcoNativeSync.js) to re-export both functions from `jwtUtils.js` so the existing public surface is preserved. Any internal usage of these functions inside `costcoNativeSync.js` should now import from `jwtUtils.js`.

### 2. `frontend/src/services/syncDebugFlags.js` (new)

```js
/**
 * Read all known sync flags from localStorage. Fresh read on every call.
 * @returns {{
 *   tierTrace: boolean,
 *   telemetryDevPanel: boolean,
 *   autoEnabled: boolean,
 *   minResyncMsOverride: number | null,
 * }}
 */
export function readFlags() { /* ... */ }

/**
 * Redact a value for safe logging.
 * Returns `<length=N, head=ABCDEF>` for strings longer than 6 chars;
 * returns the literal `'<empty>'` for empty/null/undefined;
 * returns the value as-is for numbers/booleans.
 */
export function redact(value) { /* ... */ }

/**
 * Emit a structured trace line when SYNC_TIER_TRACE=1.
 * Must be a no-op (early return) when the flag is off, before evaluating data.
 * @param {string} tag - e.g. "t2.safeway.cookieRead"
 * @param {object} [data] - Plain object; values should be passed through redact() by the caller when sensitive.
 */
export function trace(tag, data) { /* ... */ }
```

Flag sources (localStorage string keys; treat `'1'` as true, anything else as false):
- `SYNC_TIER_TRACE`
- `SYNC_TELEMETRY_DEV_PANEL`
- `SYNC_AUTO_ENABLED`
- `SYNC_MIN_RESYNC_MS_OVERRIDE` (parsed as integer; `null` if absent or NaN)

### 3. `frontend/src/services/syncTelemetry.js` (new)

Persisted blob per provider in `Preferences` under key `sync_telemetry_<provider>`. Falls back to `localStorage` using the same pattern as [frontend/src/services/tokenStorage.js](../../../frontend/src/services/tokenStorage.js).

**Persisted shape:**

```js
{
  tierAttempts:   { t1: 0, t2: 0, t3: 0, t4: 0 },
  tierSuccesses:  { t1: 0, t2: 0, t3: 0 },
  tierDurationsMs:{ t2: [], t3: [] },  // rolling last 20 each
  lastTierUsed:   null,                // 't2' | 't3' | null
  lastSyncAt:     null,                // epoch ms | null
  failureReasons: {
    cookie_missing: 0, parse_error: 0, token_expired: 0, clubcard_missing: 0,
    auth_401: 0, auth_403: 0, network: 0, webview_timeout: 0,
    webview_closed_early: 0, unknown: 0,
  },
  cookieStorePersistent: null,         // true | false | null (unprobed)
  getCookiesWithoutWebViewWorks: null, // true | false | null (unprobed)
}
```

**API:**

```js
/**
 * @param {object} entry
 * @param {'t1'|'t2'|'t3'|'t4'} entry.tier
 * @param {'attempt'|'success'|'fail'} entry.outcome
 * @param {string} [entry.reason]      // failure reason enum; mapped to 'unknown' if not in enum
 * @param {number} [entry.durationMs]  // only recorded for tier successes
 * @param {string} entry.provider
 */
export async function record(entry) { /* ... */ }

export async function markCookieStorePersistent(provider, ok) { /* ... */ }
export async function markGetCookiesWithoutWebView(provider, ok) { /* ... */ }
export async function read(provider) { /* returns full blob */ }
export async function reset(provider) { /* resets to default shape */ }
```

- `tierDurationsMs.t{n}` rolls at 20 entries (drop oldest).
- On `success`, also set `lastTierUsed` and `lastSyncAt`.
- On `success`, increment `tierSuccesses[tier]`.
- On every `attempt`, increment `tierAttempts[tier]`.
- On `fail`, increment `failureReasons[reason]` (mapping unknown reasons to `'unknown'`).

### 4. `frontend/src/services/tokenStorage.js` (modified)

Add two new methods to the object returned by `createTokenStorage(config)`. Do not change existing method behavior.

```js
/**
 * Store arbitrary metadata alongside tokens. Keys that are not in prefKeys/secureKeys
 * are stored under `${localStoragePrefix}meta_${key}` in Preferences or localStorage.
 */
async storeMeta(values) { /* ... */ }

/**
 * Retrieve all known metadata keys. Return shape mirrors storeMeta input.
 */
async getMeta() { /* ... */ }
```

Extend the config optionally with `metaKeys: string[]` so providers declare which metadata keys they use (e.g. `['tokenExp', 'lastSyncAt', 'clubCard']`). `getMeta()` reads exactly those keys and returns `{ [k]: string | null }`.

**Backward compatibility:** `createTokenStorage` calls without `metaKeys` must behave exactly as before. Existing `safewayWebViewBridge.js` / `costcoWebViewBridge.js` callers are not updated in Phase 1 -- that is Phase 3.

---

## Logic Guardrails

- `isTokenExpired` returns `true` for: `null`, `undefined`, empty string, malformed token, token missing `exp` claim, token whose `exp` has passed (after `bufferSeconds`).
- `decodeJwtPayload` must never throw. On any error return `{}`.
- `redact` must never emit the raw value. For strings >6 chars it returns `<length=N, head=ABCDEF>` (first 6 characters only). For strings <=6 chars it still truncates to length, never exposing content (`<length=N>`). For numbers/booleans it returns them as-is.
- `trace` evaluates its own no-op path (flag check) before reading `data`. Do not perform any work when the flag is off.
- `trace` output format: `console.log('[SyncTrace][' + tag + ']', data)`. One log line per call.
- `syncTelemetry` operations must be tolerant of missing/malformed persisted blobs: read with a default-blob fallback; never throw to the caller.
- `syncTelemetry` persists as a single JSON string; do not spread it across multiple keys.
- `tierDurationsMs[tier]` is only appended on `success` entries; `attempt` and `fail` must not append.
- `reason` mapping: any value not in the fixed enum is stored as `'unknown'`. Do not silently add new reason keys.
- `storeMeta` and `getMeta` use the same Preferences/localStorage fallback ladder as existing `store`/`get`. Do not introduce a new storage backend.
- No module in this phase may import anything from `@capgo/inappbrowser`, `webViewBridge.js`, or any provider bridge. Import graph must be leaf-only.
- No module in this phase may call any backend API.
- No telemetry or debug output contains raw tokens, raw cookie values, or any PII.

---

## Test-First Suite

All tests live under `frontend/src/services/__tests__/` and run with `vitest`.

### `jwtUtils.test.js`

- `JWT_DECODE_VALID_PAYLOAD` - given a token with known `{sub, exp}`, returns that object.
- `JWT_DECODE_MALFORMED_TOKEN_RETURNS_EMPTY_OBJECT` - token with two parts, random junk, non-base64 payload all return `{}`.
- `JWT_DECODE_NULL_OR_EMPTY_RETURNS_EMPTY_OBJECT`.
- `IS_EXPIRED_RETURNS_TRUE_WHEN_EXP_PAST`.
- `IS_EXPIRED_RETURNS_FALSE_WHEN_EXP_FUTURE`.
- `IS_EXPIRED_RETURNS_TRUE_WITHIN_BUFFER` - exp is 30s in future, buffer is 60s, expect `true`.
- `IS_EXPIRED_RETURNS_TRUE_WHEN_EXP_MISSING`.
- `IS_EXPIRED_RETURNS_TRUE_WHEN_TOKEN_NULL`.

### `syncDebugFlags.test.js`

- `READ_FLAGS_ALL_OFF_WHEN_LOCALSTORAGE_EMPTY`.
- `READ_FLAGS_TIER_TRACE_ON_WHEN_VALUE_IS_1`.
- `READ_FLAGS_TIER_TRACE_OFF_FOR_OTHER_VALUES` (covering `'0'`, `'true'`, `''`).
- `READ_FLAGS_MIN_RESYNC_MS_PARSED_AS_INT` - `'60000'` -> `60000`; `'abc'` -> `null`.
- `TRACE_NOOP_WHEN_FLAG_OFF` - spy on `console.log` and assert zero calls.
- `TRACE_LOGS_WHEN_FLAG_ON` - assert prefix and payload passthrough.
- `REDACT_LONG_STRING` - "supersecretvalue" -> `<length=16, head=supers>`.
- `REDACT_SHORT_STRING` - "abc" -> `<length=3>`.
- `REDACT_EMPTY_OR_NULL` -> `<empty>`.
- `REDACT_NUMBER_OR_BOOL` returned as-is.

### `syncTelemetry.test.js`

Mock `@capacitor/preferences` and `localStorage` (use the same pattern as existing `tokenStorage` tests if present, otherwise inline mocks).

- `RECORD_ATTEMPT_INCREMENTS_TIER_ATTEMPTS`.
- `RECORD_SUCCESS_INCREMENTS_TIER_SUCCESSES_AND_UPDATES_LAST_TIER_USED`.
- `RECORD_SUCCESS_APPENDS_DURATION`.
- `RECORD_FAIL_INCREMENTS_FAILURE_REASON`.
- `RECORD_FAIL_UNKNOWN_REASON_MAPPED_TO_UNKNOWN`.
- `TIER_DURATIONS_ROLLS_AT_20` - 25 records, only last 20 retained.
- `MARK_COOKIE_STORE_PERSISTENT_PERSISTS_VALUE`.
- `MARK_GET_COOKIES_WITHOUT_WEBVIEW_PERSISTS_VALUE`.
- `READ_RETURNS_DEFAULT_BLOB_WHEN_UNSET`.
- `READ_TOLERATES_MALFORMED_STORED_BLOB` - corrupt JSON in storage returns default blob, does not throw.
- `RESET_CLEARS_BLOB`.
- `PROVIDER_ISOLATION` - safeway records do not affect costco blob.

### `tokenStorage.test.js` (extended)

- `STORE_META_AND_GET_META_ROUNDTRIP` - declare `metaKeys: ['tokenExp', 'lastSyncAt']`, store them, retrieve the same values.
- `GET_META_RETURNS_NULL_FOR_UNSET_KEYS`.
- `META_KEYS_OMITTED_WHEN_CONFIG_MISSING_THEM` - `getMeta` returns `{}` if `metaKeys` not provided.
- `EXISTING_STORE_BEHAVIOR_UNCHANGED` - existing store/get/has/clear tests still pass.

---

## Definition of Done

- [ ] `frontend/src/services/jwtUtils.js` exists with `decodeJwtPayload` and `isTokenExpired`.
- [ ] `frontend/src/services/costcoNativeSync.js` re-exports both from `jwtUtils.js`; all existing imports still resolve.
- [ ] `frontend/src/services/syncDebugFlags.js` exports `readFlags`, `trace`, `redact` matching the contract above.
- [ ] `frontend/src/services/syncTelemetry.js` exports `record`, `markCookieStorePersistent`, `markGetCookiesWithoutWebView`, `read`, `reset`.
- [ ] `frontend/src/services/tokenStorage.js` adds `storeMeta` / `getMeta`; existing behavior unchanged.
- [ ] All new vitest suites pass (`npm test` in `frontend/`).
- [ ] `rg 'from .*(jwtUtils|syncDebugFlags|syncTelemetry)'` matches ONLY test files and internal re-exports in `costcoNativeSync.js`. Production code paths have zero new imports.
- [ ] Manual smoke test: run app, do a manual Safeway sync, sync completes exactly as before. No new console output.
- [ ] No new ESLint errors in touched files.
- [ ] Logic Audit report: bullet-list the constraints above and mark each as verified.
