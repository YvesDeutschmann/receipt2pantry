# Silent Sync Phase 3 -- Bridge and Providers

> **Prerequisite:** Phases 1 and 2 are complete and merged. `silentSyncOrchestrator`, `syncTelemetry`, `syncDebugFlags`, `jwtUtils`, and the extended `tokenStorage` are available and fully tested.
>
> **Scope:** Extend the shared `webViewBridge.js` with two new hooks and a new method; add Safeway's real silent-refresh implementation; add a cookie-store persistence probe; add a Costco stub; rewire the Safeway user-facing button path through the orchestrator.
>
> **Do NOT touch in this phase:** the initial login flow (`startLogin` internals), `safewayApiFetcher.js`, `safewayExtractScript.js`, any backend route or service, any UI component. The `useAppSyncScheduler` hook is Phase 4.

---

## Objective

Connect the orchestrator to real data for Safeway, and preserve Costco behavior via a stub. After this phase, pressing the existing "Silent Sync" button for Safeway routes through the full tier cascade; the warm path (Tier 2) reads the HttpOnly session cookie directly without opening a WebView. Costco behavior is unchanged but wired through the orchestrator for future uplift.

The cookie-store persistence probe writes a canary at login and evaluates on the next cold start, producing two diagnostic booleans that land in the telemetry blob.

---

## Technical Contract

### 1. `frontend/src/services/webViewBridge.js` (modified)

Add to the `createWebViewBridge(config)` config surface (all optional, backward compatible):

```ts
{
  // ... existing fields ...

  /** Returns usable tokens + cookieHeader from storage/native-cookie-store, or null. */
  silentRefresh?: (meta: object) => Promise<{accessToken: string, ...} | null>,

  /** Pluck stable per-user metadata from a tokens/receipts message to persist alongside tokens. */
  extractPersistMeta?: (d: object) => Record<string, string | null>,

  /** Names of metadata keys (forwarded into tokenStorage meta). */
  metaKeys?: string[],
}
```

Behavior additions:

1. When `config.metaKeys` is provided, pass it through to `createTokenStorage({ metaKeys })` (actually configured by the provider-level bridge file, not the factory; see below).
2. **On successful login** (after `tokenStorage.store(tokens)` in `handleTokensMessage` / `handleReceiptsMessage`):
   - If `config.extractPersistMeta` is defined, call it with the same message payload `d` and await `tokenStorage.storeMeta({ ...extractPersistMeta(d), tokenExp: computeExp(tokens) })`.
   - `computeExp(tokens)` = `decodeJwtPayload(tokens.accessToken ?? tokens.idToken)?.exp ?? null`.
3. **New public bridge method:**

```js
/**
 * Run the silent sync cascade via the orchestrator.
 * @param {object} opts
 * @param {string} opts.userId
 * @param {(tokens: object) => Promise<Array<any>>} [opts.apiFetch]
 * @param {(receipts: Array<any>) => Promise<object>} opts.ingest
 * @param {number} [opts.minResyncMs]
 */
async refreshAndFetch(opts) {
  const { runSilentSync } = await import('./silentSyncOrchestrator');
  return runSilentSync({
    provider: config.provider,
    bridge: this,                              // exposes startSilentSync()
    silentRefresh: config.silentRefresh ?? (async () => null),
    apiFetch: opts.apiFetch,
    ingest: opts.ingest,
    getMeta: () => tokenStorage.getMeta(),
    minResyncMs: opts.minResyncMs,
  });
}
```

**Do not change** the existing `startLogin` or `startSilentSync` method bodies beyond the two persistence hooks above. No changes to message handlers beyond the `extractPersistMeta` call.

### 2. `frontend/src/services/safewaySilentRefresh.js` (new)

```js
import { InAppBrowser } from '@capgo/inappbrowser';
import { isTokenExpired } from './jwtUtils';
import * as syncTelemetry from './syncTelemetry';
import { trace, redact } from './syncDebugFlags';

const SAFEWAY_URL = 'https://www.safeway.com';
const SESSION_COOKIE = 'SWY_SHARED_SESSION';

export function isAllowedSafewayCookieKey(k) { /* same allowlist as safewayWebViewBridge.js lines 12-24 */ }

export function buildCookieHeader(cookies) {
  // Filter via isAllowedSafewayCookieKey, join with '; '. Never logs raw values.
}

/**
 * Tier 2 refresh for Safeway: read cookies natively, parse HttpOnly session,
 * return usable tokens without opening a WebView.
 * Returns null (with a telemetry reason logged) on any miss.
 */
export async function safewaySilentRefresh(meta) { /* ... */ }
```

**Algorithm:**

```js
let cookies;
try {
  cookies = await InAppBrowser.getCookies({ url: SAFEWAY_URL, includeHttpOnly: true });
} catch (e) {
  await syncTelemetry.markGetCookiesWithoutWebView('safeway', false);
  await syncTelemetry.record({ provider: 'safeway', tier: 't2', outcome: 'fail', reason: 'cookie_missing' });
  trace('t2.safeway.getCookiesThrew', { message: e?.message });
  return null;
}
await syncTelemetry.markGetCookiesWithoutWebView('safeway', true);
trace('t2.safeway.cookieKeys', { keys: Object.keys(cookies || {}) });

const raw = cookies?.[SESSION_COOKIE];
if (!raw) {
  await syncTelemetry.record({ provider: 'safeway', tier: 't2', outcome: 'fail', reason: 'cookie_missing' });
  return null;
}

let parsed;
try {
  parsed = JSON.parse(decodeURIComponent(raw));
} catch (e) {
  await syncTelemetry.record({ provider: 'safeway', tier: 't2', outcome: 'fail', reason: 'parse_error' });
  trace('t2.safeway.parseFailed', {});
  return null;
}

const accessToken = parsed?.accessToken;
if (!accessToken) {
  await syncTelemetry.record({ provider: 'safeway', tier: 't2', outcome: 'fail', reason: 'parse_error' });
  return null;
}
if (isTokenExpired(accessToken, 60)) {
  await syncTelemetry.record({ provider: 'safeway', tier: 't2', outcome: 'fail', reason: 'token_expired' });
  trace('t2.safeway.tokenExpired', { accessToken: redact(accessToken) });
  return null;
}
const clubCard = meta?.clubCard;
if (!clubCard) {
  await syncTelemetry.record({ provider: 'safeway', tier: 't2', outcome: 'fail', reason: 'clubcard_missing' });
  return null;
}

const cookieHeader = buildCookieHeader(cookies);
trace('t2.safeway.ok', { accessToken: redact(accessToken), cookieHeaderLength: cookieHeader.length });
return { accessToken, clubCard, cookieHeader };
```

### 3. `frontend/src/services/costcoSilentRefresh.js` (new)

```js
/**
 * Costco silent refresh stub. Returns null so the orchestrator falls to Tier 3
 * (existing hidden-WebView silent sync). A real implementation would call
 * Costco's token-refresh endpoint using the stored refreshToken.
 * TODO(phase-future): Implement real Tier 2 using refreshToken + refreshTokenClientId.
 */
export async function costcoSilentRefresh(_meta) {
  return null;
}
```

### 4. `frontend/src/services/cookieStorePersistenceProbe.js` (new)

```js
import { Preferences } from '@capacitor/preferences';
import { InAppBrowser } from '@capgo/inappbrowser';
import * as syncTelemetry from './syncTelemetry';
import { trace } from './syncDebugFlags';

const PROBE_KEY = (provider) => `sync_cookieProbe_${provider}`;

/**
 * Call at successful login. Records the expected session cookie name and timestamp.
 */
export async function writeCanary(provider, sessionCookieName) { /* ... */ }

/**
 * Call once per process, on the first scheduler run. Reads canary + cookies, writes both telemetry booleans.
 * No-op if no canary exists.
 */
export async function evaluate(provider, url) { /* ... */ }
```

**`evaluate` algorithm:**

```js
const { value } = await Preferences.get({ key: PROBE_KEY(provider) });
if (!value) return;
let canary;
try { canary = JSON.parse(value); } catch { return; }

let cookies;
try {
  cookies = await InAppBrowser.getCookies({ url, includeHttpOnly: true });
} catch (e) {
  await syncTelemetry.markGetCookiesWithoutWebView(provider, false);
  trace('probe.getCookiesThrew', { provider, message: e?.message });
  return;
}
await syncTelemetry.markGetCookiesWithoutWebView(provider, true);

const present = Object.prototype.hasOwnProperty.call(cookies, canary.sessionCookieName);
await syncTelemetry.markCookieStorePersistent(provider, present);
trace('probe.result', { provider, persistent: present });
```

### 5. `frontend/src/services/safewayWebViewBridge.js` (modified)

Additions (no existing behavior changes):

```js
import { safewaySilentRefresh } from './safewaySilentRefresh';
import { writeCanary } from './cookieStorePersistenceProbe';
import { api } from './apiClient';

const tokenStorage = createTokenStorage({
  prefKeys: { accessToken: 'safeway_accessToken', clubCard: 'safeway_clubCard' },
  secureKeys: {},
  localStoragePrefix: 'safeway_',
  hasCheckKeys: ['accessToken'],
  metaKeys: ['tokenExp', 'lastSyncAt', 'clubCard'],  // NEW
});

const bridge = createWebViewBridge({
  // ... existing config ...
  silentRefresh: safewaySilentRefresh,                               // NEW
  extractPersistMeta: (d) => ({ clubCard: d.clubCard ?? null }),     // NEW
});

// Write canary after successful login (patch startLogin externally via wrapping):
export async function startLogin() {
  const result = await bridge.startLogin();
  if (result?.accessToken) {
    await writeCanary('safeway', 'SWY_SHARED_SESSION').catch(() => {});
  }
  return result;
}

// New wrapper used by the scheduler (Phase 4) AND the silent button (below).
export async function runSafewaySilentSync(userId) {
  return bridge.refreshAndFetch({
    userId,
    apiFetch: async (tokens) => {
      const { fetchSafewayReceipts } = await import('./safewayApiFetcher');
      const { parseSafewayReceipt } = await import('./safewayReceiptParser');
      const knownOrderIds = await fetchKnownOrderIds(userId);   // same helper as useSafewaySync
      const raw = await fetchSafewayReceipts({
        accessToken: tokens.accessToken,
        clubCard: tokens.clubCard,
        cookieHeader: tokens.cookieHeader,
        knownOrderIds,
        daysOverride: 3,
      });
      return (raw || []).map((r) => parseSafewayReceipt(r)).filter(Boolean);
    },
    ingest: async (receipts) => api.ingestReceipts('safeway', receipts, userId),
  });
}
```

The `hasCheckKeys` remains unchanged. Existing `startSync` (full login) path remains untouched for Phase 3; only `startSilent` in the hook will be rewired (see below).

### 6. `frontend/src/services/costcoWebViewBridge.js` (modified)

Analogous additions, using the Costco stub:

```js
import { costcoSilentRefresh } from './costcoSilentRefresh';

createTokenStorage({ /* ... */ metaKeys: ['tokenExp', 'lastSyncAt', 'userAgent'] });

createWebViewBridge({
  // ...
  silentRefresh: costcoSilentRefresh,
  extractPersistMeta: (d) => ({ userAgent: d.userAgent ?? null }),
});

export async function runCostcoSilentSync(userId) {
  return bridge.refreshAndFetch({
    userId,
    // No apiFetch: Costco silent sync currently returns receipts inline from the WebView.
    ingest: async (receipts) => api.storeCostcoReceipts(receipts, userId),
  });
}
```

### 7. `frontend/src/hooks/useSafewaySync.js` (modified)

Replace the body of `startSilent` with a single call to `runSafewaySilentSync(userId)`; translate the orchestrator outcome into the existing state machine:

| Orchestrator outcome | UI state |
|---|---|
| `'synced'` | `STATUS.SUCCESS`, `result = {receipts, count, receipts_stored, items_added_to_pantry, errors:[]}` |
| `'skipped'` | `STATUS.IDLE`, no error, no result |
| `'needs_reconnect'` | `STATUS.ERROR`, error `'Safeway session expired. Please sign in again.'`, and call `clearStoredTokens()` |
| `'error'` | `STATUS.ERROR`, error from `.error.message` |

`startSync` (full login path) is NOT changed in Phase 3.

If a Costco equivalent hook exists (check for `useCostcoSync.js`), apply the same pattern. Otherwise skip -- Costco's `CostcoOneTapSync` component will be audited and wired in Phase 4 or a follow-up.

---

## Logic Guardrails

- **Tier 2 must never open a WebView.** `safewaySilentRefresh` calls only `InAppBrowser.getCookies(...)`; it must not call `openWebView`, `executeScript`, or `startSilentSync`.
- **Every null return from `safewaySilentRefresh` records a telemetry `t2.fail` with a specific reason.** The orchestrator (Phase 2) does not record `t2.fail` for null returns, so this module is solely responsible.
- **Cookie allowlist is the single source of truth.** `buildCookieHeader` must apply `isAllowedSafewayCookieKey` to keys. Do not log raw cookie values anywhere. Trace only key names (and `cookieHeaderLength`, never content).
- **Tokens in logs must be redacted.** Every `trace` call involving an access token passes it through `redact`.
- **`extractPersistMeta` is called only from tokens/receipts message handlers**, never from debug/progress messages.
- **`tokenExp` is computed from the accessToken JWT `exp` claim** via `decodeJwtPayload`. If absent, store `null`.
- **`writeCanary` runs at the end of every successful login**, overwriting the prior canary so rotated cookies get re-probed on the next cold start.
- **`evaluate` is idempotent per process** -- subsequent calls within the same process are allowed but should not produce duplicate telemetry writes; implementers may early-return if telemetry has already been populated. (Not strictly required for correctness, but preferred.)
- **Costco stub returns `null` synchronously wrapped in an async.** It must not touch storage, network, or the bridge.
- **The `refreshAndFetch` method is the only new orchestrator-invoking entrypoint** added to the bridge. Do not add others.
- **`hasCheckKeys` remains `['accessToken']` for Safeway.** The `clubCard`/`tokenExp` metadata belongs in `metaKeys`, not `prefKeys`, to keep the "has tokens" signal single-purpose.
- **No behavior change to the initial login flow** beyond the two new post-login hooks (`storeMeta` + `writeCanary`). Diffs to `startLogin` / message handlers should be minimal.
- **Do not delete `getStoredTokens` exports** even if unused. Removing exports is a cleanup for a later PR.
- **No changes to `safewayApiFetcher.js` or `safewayExtractScript.js`.** They are stable.
- **All new Preferences keys use the `sync_` prefix** (`sync_cookieProbe_<provider>`, `sync_telemetry_<provider>`) for easy wipe.

---

## Test-First Suite

All tests live under `frontend/src/services/__tests__/` and `frontend/src/hooks/__tests__/` where noted.

### `safewaySilentRefresh.test.js`

Mock `@capgo/inappbrowser` and `syncTelemetry`.

- `HAPPY_PATH_RETURNS_TOKENS` -- getCookies returns valid SWY_SHARED_SESSION with unexpired JWT; meta has clubCard. Expect `{accessToken, clubCard, cookieHeader}`. Assert `markGetCookiesWithoutWebView(true)` and no `t2.fail`.
- `GET_COOKIES_THROWS_MARKS_FALSE_AND_RETURNS_NULL` -- expect `markGetCookiesWithoutWebView(false)` and `t2.fail reason=cookie_missing`.
- `MISSING_SESSION_COOKIE_RETURNS_NULL_COOKIE_MISSING` -- getCookies returns `{}`.
- `MALFORMED_JSON_RETURNS_NULL_PARSE_ERROR`.
- `MISSING_ACCESS_TOKEN_RETURNS_NULL_PARSE_ERROR` -- parsed JSON lacks `accessToken` field.
- `EXPIRED_TOKEN_RETURNS_NULL_TOKEN_EXPIRED`.
- `MISSING_CLUB_CARD_RETURNS_NULL_CLUBCARD_MISSING` -- meta is `{}`.
- `COOKIE_HEADER_ALLOWLIST_APPLIED` -- getCookies returns mix of allowed + disallowed keys (e.g. `AMCV_*`, `_ga`). Assert output header contains only allowed keys.
- `TRACE_REDACTS_ACCESS_TOKEN` -- spy on console; assert no raw token substring appears in any log call.

### `cookieStorePersistenceProbe.test.js`

Mock `@capacitor/preferences` and `@capgo/inappbrowser`.

- `WRITE_CANARY_PERSISTS_EXPECTED_FIELDS` -- assert Preferences set with `{writtenAt, sessionCookieName}`.
- `EVALUATE_NO_CANARY_NOOP`.
- `EVALUATE_MALFORMED_CANARY_NOOP`.
- `EVALUATE_GETCOOKIES_THROWS_MARKS_GET_COOKIES_FALSE`.
- `EVALUATE_COOKIE_PRESENT_MARKS_PERSISTENT_TRUE` -- getCookies returns `{SWY_SHARED_SESSION: 'x'}`.
- `EVALUATE_COOKIE_ABSENT_MARKS_PERSISTENT_FALSE` -- getCookies returns `{}`.
- `EVALUATE_MARKS_GET_COOKIES_TRUE_REGARDLESS_OF_COOKIE_PRESENCE`.

### `webViewBridge.test.js` (new or extended)

Mock `@capgo/inappbrowser` and the `silentSyncOrchestrator` module.

- `LOGIN_PERSISTS_EXTRACT_PERSIST_META` -- simulate tokens message with `clubCard: '123'`; assert `tokenStorage.storeMeta` was called with `{clubCard:'123', tokenExp: <number-or-null>}`.
- `LOGIN_PERSISTS_TOKEN_EXP_FROM_JWT` -- tokens message with an accessToken JWT whose `exp` is known. Assert persisted `tokenExp` equals that value.
- `LOGIN_HANDLES_MISSING_EXP_GRACEFULLY` -- no `exp` claim; persisted `tokenExp` is `null`; no throw.
- `REFRESH_AND_FETCH_DELEGATES_TO_ORCHESTRATOR` -- call `bridge.refreshAndFetch({userId, apiFetch, ingest})`; assert `runSilentSync` called with correct `provider`, `silentRefresh`, `apiFetch`, `ingest`, `getMeta`.
- `EXTRACT_PERSIST_META_ABSENT_OK` -- omit the config key; login still succeeds without error.

### `useSafewaySync.test.js` (extended; existing test file lives at `frontend/src/tests/useSafewaySync.test.js`)

Mock `runSafewaySilentSync`.

- `START_SILENT_SYNCED_MAPS_TO_SUCCESS`.
- `START_SILENT_SKIPPED_MAPS_TO_IDLE`.
- `START_SILENT_NEEDS_RECONNECT_MAPS_TO_ERROR_AND_CLEARS_TOKENS` -- assert `clearStoredTokens` was called.
- `START_SILENT_ERROR_OUTCOME_SURFACES_ERROR_MESSAGE`.
- `START_SYNC_FULL_LOGIN_PATH_UNCHANGED` -- snapshot-style or behavioral assertion that `startSync` still goes through the existing flow.

### On-device validation checklist (no automation; gated by reviewer)

Perform on both iOS and Android builds with `SYNC_TIER_TRACE=1`:

- [ ] Fresh install -> complete initial login -> inspect `Preferences` for `sync_cookieProbe_safeway` and `safeway_meta_clubCard`.
- [ ] Cold kill -> reopen -> trigger Silent Sync button -> console shows `[SyncTrace][probe.result]` with `persistent: true|false` and `[SyncTrace][t2.safeway.*]` lines.
- [ ] Telemetry blob inspection (`Preferences` -> `sync_telemetry_safeway`): tier counters reflect the sync; `cookieStorePersistent` and `getCookiesWithoutWebViewWorks` populated.
- [ ] Happy path sync completes and ingests receipts as before.
- [ ] With `SYNC_TIER_TRACE=0`, no new console noise.

---

## Definition of Done

- [ ] `webViewBridge.js` gains `silentRefresh`, `extractPersistMeta`, `metaKeys` (pass-through), `refreshAndFetch` method, and post-login meta persistence. No existing test breaks.
- [ ] `safewaySilentRefresh.js` implements the Tier 2 algorithm with full telemetry/trace instrumentation.
- [ ] `costcoSilentRefresh.js` returns `null` per the stub contract.
- [ ] `cookieStorePersistenceProbe.js` exposes `writeCanary` and `evaluate` with all four outcome branches covered by tests.
- [ ] `safewayWebViewBridge.js` registers the new hooks, declares `metaKeys`, wraps `startLogin` to call `writeCanary`, and exports `runSafewaySilentSync(userId)`.
- [ ] `costcoWebViewBridge.js` registers the stub and exports `runCostcoSilentSync(userId)`.
- [ ] `useSafewaySync.js` routes `startSilent` through `runSafewaySilentSync`; `startSync` unchanged.
- [ ] `npm test` green, all new tests passing; existing `useSafewaySync` and `webViewBridge` tests still green or updated to match the new behavior.
- [ ] On-device checklist above completed on at least one platform; results pasted into the PR description.
- [ ] Telemetry blob for Safeway populated after a real sync on device.
- [ ] `rg 'safewaySilentRefresh\|costcoSilentRefresh\|cookieStorePersistenceProbe'` shows only the new files and their consumers listed above.
- [ ] No raw tokens or raw cookie values appear in any console output (grep the trace output of a live run for known substrings).
- [ ] No new ESLint errors.
- [ ] Logic Audit: map every "Logic Guardrails" bullet to the test IDs / code paths that enforce it.
