# Silent Sync Phase 2 -- Orchestrator

> **Prerequisite:** Phase 1 must be complete and merged. `jwtUtils.js`, `syncDebugFlags.js`, `syncTelemetry.js`, and the extended `tokenStorage.js` must be available and fully tested.
>
> **Scope:** One new module plus one test file. Zero production wiring. Still no behavior change to any existing feature at the end of this phase.
>
> **Do NOT touch in this phase:** `webViewBridge.js`, `safewayWebViewBridge.js`, `costcoWebViewBridge.js`, any provider refresh helper (they come in Phase 3), any React hook, any component, any backend file.

---

## Objective

Build the pure orchestration "brain" that executes the 4-tier silent-sync cascade. All external collaborators (bridge, silentRefresh, apiFetch, ingest) are passed in as dependencies so this module stays a pure coordinator, fully unit-testable without Capacitor, without network, and without React. At the end of this phase the orchestrator exists and passes tests but is not yet imported by any production file.

---

## Technical Contract

### `frontend/src/services/silentSyncOrchestrator.js` (new)

```js
import * as syncTelemetry from './syncTelemetry';
import { trace, readFlags } from './syncDebugFlags';

/**
 * @typedef {Object} OrchestratorOptions
 * @property {string} provider                  // e.g. 'safeway' | 'costco'
 * @property {object} bridge                    // object with startSilentSync(): Promise<tokens|null>
 * @property {(meta: object) => Promise<object|null>} silentRefresh
 * @property {(tokens: object) => Promise<Array<any>>} [apiFetch] // null for providers that fetch in-WebView (Costco)
 * @property {(receipts: Array<any>) => Promise<object>} ingest   // returns { receipts_stored, items_added_to_pantry, errors }
 * @property {() => Promise<object>} getMeta                      // returns { tokenExp, lastSyncAt, clubCard, ...provider metadata }
 * @property {number} [minResyncMs=14400000]                      // 4h default
 * @property {() => number} [now=Date.now]
 */

/**
 * @typedef {Object} OrchestratorResult
 * @property {'synced'|'skipped'|'needs_reconnect'|'error'} outcome
 * @property {'t2'|'t3'|null} tier
 * @property {Array<any>} [receipts]
 * @property {number} [items_added]
 * @property {number} [receipts_stored]
 * @property {Error} [error]
 */

export async function runSilentSync(opts) { /* ... */ }

/**
 * Maps an Error (or error-like object) to a telemetry failure reason enum.
 * Exported only for testing.
 */
export function classifyError(err) { /* ... */ }

/**
 * Returns true for HTTP 401/403-style errors, whether via `err.status` or message regex.
 * Exported only for testing.
 */
export function isAuthError(err) { /* ... */ }
```

**Algorithm (authoritative):**

```js
const now = (opts.now ?? Date.now)();
const flags = readFlags();
const minResyncMs = flags.minResyncMsOverride ?? opts.minResyncMs ?? 14_400_000;

const meta = await opts.getMeta();
if (meta.lastSyncAt && (now - Number(meta.lastSyncAt)) < minResyncMs) {
  trace('orchestrator.skippedThrottled', { provider: opts.provider });
  return { outcome: 'skipped', tier: null };
}

// Tier 2
await syncTelemetry.record({ provider: opts.provider, tier: 't2', outcome: 'attempt' });
let t2Tokens = null;
try {
  t2Tokens = await opts.silentRefresh(meta);
} catch (e) {
  trace('orchestrator.t2Threw', { message: e?.message });
  t2Tokens = null;
}
trace('orchestrator.t2Refresh', { ok: !!t2Tokens });

if (t2Tokens) {
  try {
    const result = await fetchAndIngest(opts, t2Tokens, 't2');
    return result;
  } catch (e) {
    const reason = classifyError(e);
    await syncTelemetry.record({ provider: opts.provider, tier: 't2', outcome: 'fail', reason });
    if (!isAuthError(e)) {
      trace('orchestrator.t2NonAuthError', { reason });
      return { outcome: 'error', tier: 't2', error: e };
    }
    trace('orchestrator.t2AuthErrorCascade', {});
  }
}

// Tier 3
await syncTelemetry.record({ provider: opts.provider, tier: 't3', outcome: 'attempt' });
let t3Tokens = null;
try {
  t3Tokens = await opts.bridge.startSilentSync();
} catch (e) {
  trace('orchestrator.t3Threw', { message: e?.message });
  t3Tokens = null;
}
if (!t3Tokens || !t3Tokens.accessToken) {
  await syncTelemetry.record({
    provider: opts.provider, tier: 't3', outcome: 'fail',
    reason: t3Tokens ? 'unknown' : 'webview_closed_early',
  });
  await syncTelemetry.record({ provider: opts.provider, tier: 't4', outcome: 'attempt' });
  return { outcome: 'needs_reconnect', tier: 't3' };
}
try {
  return await fetchAndIngest(opts, t3Tokens, 't3');
} catch (e) {
  const reason = classifyError(e);
  await syncTelemetry.record({ provider: opts.provider, tier: 't3', outcome: 'fail', reason });
  await syncTelemetry.record({ provider: opts.provider, tier: 't4', outcome: 'attempt' });
  return { outcome: 'needs_reconnect', tier: 't3' };
}
```

Helper:

```js
async function fetchAndIngest(opts, tokens, tier) {
  const started = Date.now();
  let receipts;
  if (opts.apiFetch) {
    receipts = await opts.apiFetch(tokens);
  } else {
    // Costco path: bridge.startSilentSync already returned receipts
    receipts = Array.isArray(tokens.receipts) ? tokens.receipts : [];
  }
  const ingested = await opts.ingest(receipts);
  const durationMs = Date.now() - started;
  await syncTelemetry.record({
    provider: opts.provider, tier, outcome: 'success', durationMs,
  });
  return {
    outcome: 'synced',
    tier,
    receipts,
    receipts_stored: ingested?.receipts_stored ?? receipts.length,
    items_added: ingested?.items_added_to_pantry ?? 0,
  };
}
```

**`classifyError` mapping:**

| Condition | Reason |
|---|---|
| `err.status === 401` or message matches `/401\|unauthorized/i` | `auth_401` |
| `err.status === 403` or message matches `/403\|forbidden/i` | `auth_403` |
| message matches `/timeout/i` | `webview_timeout` |
| message matches `/closed before|closed early/i` | `webview_closed_early` |
| message matches `/parse|json/i` | `parse_error` |
| message matches `/network|fetch|ECONNRESET|ENETDOWN/i` | `network` |
| otherwise | `unknown` |

**`isAuthError`:** returns `true` iff `classifyError` returns `'auth_401'` or `'auth_403'`.

---

## Logic Guardrails

- **Tier order is fixed**: T2 -> T3 -> T4. Never skip a tier except via the explicit rules below.
- **Throttle skip is its own outcome** (`'skipped'`, `tier: null`). Do not write telemetry `attempt` entries when throttled.
- **T2 null return is not a failure** -- no telemetry `fail` is recorded; cascade falls to T3 directly. `silentRefresh` is expected to record its own failure reason internally (Phase 3 responsibility) before returning null.
- **T2 auth error cascades** to T3. T2 non-auth error terminates the cascade and returns `{outcome: 'error'}` so callers can surface an actual problem.
- **T3 `null` / missing accessToken** -> `needs_reconnect`. Also record a `t4.attempt` to reflect that T4 (user reconnect) is now the only path left.
- **T3 fetch error** -> `needs_reconnect`. No user-visible "error" state; the UI should invite reconnection, not retry.
- **`lastSyncAt` is written only on `'synced'`**, and only via `syncTelemetry.record({outcome:'success', ...})` (the telemetry module owns the mutation). Phase 2 must not write `lastSyncAt` anywhere else.
- **`apiFetch` is optional**. When null/undefined, treat `tokens.receipts` as the pre-fetched list (Costco shape). Do not call a missing `apiFetch`.
- **`now` and `minResyncMs` are injectable** for deterministic testing. The orchestrator must not call `Date.now()` outside these injection points during testable flows (the `fetchAndIngest` duration measurement is allowed).
- **No direct reads of localStorage, Preferences, or `@capgo/inappbrowser`.** All I/O goes through injected dependencies and `syncTelemetry`.
- **Zero production imports** at the end of Phase 2. `rg 'silentSyncOrchestrator'` must match only the new module and its test file.
- **`trace` calls must not leak tokens.** Pass only booleans, counts, durations, and error messages (already redacted upstream by callers in Phase 3).
- **`classifyError` is total**: every input maps to a valid enum value, including `null` and `undefined` errors (-> `'unknown'`).

---

## Test-First Suite

All tests in `frontend/src/services/__tests__/silentSyncOrchestrator.test.js`, using `vitest`. Mock `syncTelemetry` and `syncDebugFlags` via `vi.mock`. Use stub functions for `bridge.startSilentSync`, `silentRefresh`, `apiFetch`, `ingest`, `getMeta`.

Define a helper `buildOpts(overrides)` that returns a valid `OrchestratorOptions` with sensible defaults for the happy path.

### Throttle
- `SKIPS_WHEN_WITHIN_THROTTLE_WINDOW` -- `meta.lastSyncAt = now - 1h`, `minResyncMs = 4h`, expect `{outcome:'skipped', tier:null}`, zero telemetry writes, zero calls to `silentRefresh` / `bridge.startSilentSync`.
- `OVERRIDE_FROM_FLAG_BEATS_OPTION` -- `minResyncMsOverride = 0` in flags, `meta.lastSyncAt = now - 1min`, expect cascade runs.

### Tier 2 happy path
- `T2_HAPPY_PATH_RETURNS_SYNCED` -- `silentRefresh` returns tokens, `apiFetch` returns receipts, `ingest` returns `{receipts_stored:3, items_added_to_pantry:5}`. Expect `{outcome:'synced', tier:'t2', receipts_stored:3, items_added:5}`. Assert telemetry recorded: `t2.attempt`, `t2.success` with `durationMs` > 0.
- `T2_HAPPY_PATH_NO_API_FETCH_USES_TOKENS_RECEIPTS` -- omit `apiFetch`; `silentRefresh` returns `{accessToken, receipts:[...]}`; expect receipts taken from tokens.

### Tier 2 cascade
- `T2_NULL_CASCADES_TO_T3` -- `silentRefresh` returns `null`, T3 succeeds. Expect `tier:'t3'`, telemetry: `t2.attempt`, `t3.attempt`, `t3.success`. No `t2.fail`.
- `T2_THROWS_TREATED_AS_NULL_CASCADES_TO_T3` -- `silentRefresh` throws. No `t2.fail` recorded (per guardrail: null returns are unfailed). Cascade proceeds.
- `T2_AUTH_401_CASCADES_TO_T3` -- `apiFetch` throws with `{status:401}`. Expect `t2.fail reason=auth_401`, cascade, `t3.success`.
- `T2_AUTH_403_CASCADES_TO_T3` -- same with 403.
- `T2_NON_AUTH_ERROR_RETURNS_ERROR_OUTCOME` -- `apiFetch` throws `new Error('network down')`. Expect `{outcome:'error', tier:'t2'}`, `t2.fail reason=network`. No `t3.attempt`.

### Tier 3 cascade
- `T3_RETURNS_NULL_LEADS_TO_NEEDS_RECONNECT` -- `bridge.startSilentSync` returns `null`. Expect `{outcome:'needs_reconnect', tier:'t3'}`, `t3.fail reason=webview_closed_early`, `t4.attempt`.
- `T3_RETURNS_OBJECT_MISSING_ACCESS_TOKEN_LEADS_TO_NEEDS_RECONNECT` -- returns `{clubCard: 'x'}`.
- `T3_FETCH_ERROR_LEADS_TO_NEEDS_RECONNECT` -- `apiFetch` throws on T3. Expect `t3.fail`, `t4.attempt`, `{outcome:'needs_reconnect', tier:'t3'}`.
- `T3_HAPPY_PATH_WHEN_T2_SKIPPED` -- `silentRefresh` returns null, T3 succeeds, assert full chain.

### classifyError / isAuthError
- `CLASSIFY_STATUS_401_RETURNS_AUTH_401`.
- `CLASSIFY_STATUS_403_RETURNS_AUTH_403`.
- `CLASSIFY_MESSAGE_TIMEOUT_RETURNS_WEBVIEW_TIMEOUT`.
- `CLASSIFY_MESSAGE_NETWORK_RETURNS_NETWORK`.
- `CLASSIFY_UNKNOWN_ERROR_RETURNS_UNKNOWN`.
- `CLASSIFY_NULL_ERROR_RETURNS_UNKNOWN`.
- `IS_AUTH_ERROR_TRUE_FOR_401_403_ONLY`.

### Telemetry & trace side effects
- `TRACE_CALLS_GATED_BY_FLAG` -- with `SYNC_TIER_TRACE=off` the real `trace` would no-op; in tests we mock `trace` and assert it is still called (trace itself owns the no-op). We verify orchestrator calls `trace` at least once per tier boundary.
- `TELEMETRY_SEQUENCE_HAPPY_T2` -- assert exact order: `t2.attempt` -> `t2.success`.
- `TELEMETRY_SEQUENCE_CASCADE_T2_AUTH_T3_OK` -- exact order: `t2.attempt` -> `t2.fail` -> `t3.attempt` -> `t3.success`.
- `TELEMETRY_SEQUENCE_NEEDS_RECONNECT` -- exact order: `t2.attempt` -> (optional t2.fail) -> `t3.attempt` -> `t3.fail` -> `t4.attempt`.

---

## Definition of Done

- [ ] `frontend/src/services/silentSyncOrchestrator.js` exists with the exported contract above.
- [ ] `frontend/src/services/__tests__/silentSyncOrchestrator.test.js` has at least 20 passing cases covering every row in the Test-First Suite.
- [ ] `npm test` passes cleanly; no snapshot drift on any existing test.
- [ ] `rg 'silentSyncOrchestrator'` returns only the new source file and its test file. Production code has zero new imports.
- [ ] Manual smoke test: run the app, perform a manual Safeway sync. Existing button-triggered path is unchanged and uninstrumented by the orchestrator.
- [ ] No ESLint errors in `silentSyncOrchestrator.js`.
- [ ] Logic Audit: for each bullet in "Logic Guardrails", reference the test ID(s) and orchestrator code location that verifies it.
