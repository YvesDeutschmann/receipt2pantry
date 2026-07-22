# MVP Gap 01b — Foreground Auto-Sync (Default On)

> **Prerequisite:** Brief `01a-reconnect-ux.md` is complete and merged. `ReconnectBanner` is live in `SafewayConnectCard` and `CostcoOneTapSync` so graceful-degrade to reconnect prompt is available before the scheduler fires its first sync.
>
> **Scope:** Two production files (one new hook + one app-root modification), plus vitest tests. The silent_sync Phase 4 scheduler design is the direct foundation; this brief **replaces** Phase 4's `SYNC_AUTO_ENABLED` flag-off default with always-on behaviour while reusing its hook structure verbatim. No backend changes.
>
> **Do NOT touch in this phase:** Any service module, any provider bridge (`safewayWebViewBridge.js`, `costcoWebViewBridge.js`), `silentSyncOrchestrator.js`, `ReconnectBanner.jsx`, `SafewayConnectCard.jsx`, `CostcoOneTapSync.jsx`, or any backend file.

---

## Objective

On every app foreground, a throttled silent sync runs automatically for each connected provider. The scheduler is **on by default for all users** — this is a confirmed owner decision that overrides the silent_sync Phase 4 draft, which was flag-gated off via `SYNC_AUTO_ENABLED`. When a sync ends in `needs_reconnect` or a hard error, the scheduler stops retrying that provider and the `ReconnectBanner` (from 01a) automatically surfaces the actionable prompt — no silent failures.

After this brief:
- Opening the app triggers a background sync for every connected provider that has not synced in the last 4 hours.
- The scheduler is wired to `App.jsx` at the root; it runs exactly once.
- `SYNC_AUTO_ENABLED` becomes a **kill-switch** (opt-out override for QA / ops), not the default gate. Setting `SYNC_AUTO_ENABLED=0` suppresses the scheduler; its absence or any other value leaves it on.
- OS-level background tasks remain out of scope.

---

## Technical Contract

> **Design provenance:** The hook structure, event names, throttle key pattern, provider loop, and debounce behaviour below are taken directly from [`docs/implementation_briefs/silent_sync/phase-4-scheduler-and-ui.md`](../silent_sync/phase-4-scheduler-and-ui.md). Changes from Phase 4 are called out inline with `[CHANGED]`.

---

### Phase 01b.1 — `useAppSyncScheduler` hook

**File:** `frontend/src/hooks/useAppSyncScheduler.js` (new)

```js
import { useEffect, useRef } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { readFlags } from '../services/syncDebugFlags';
import { runSafewaySilentSync } from '../services/safewayWebViewBridge';  // [existing Phase 4 import]
import { runCostcoSilentSync } from '../services/costcoWebViewBridge';    // [existing Phase 4 import]
import { hasStoredTokens as hasSafewayTokens } from '../services/safewayWebViewBridge';
import { hasStoredTokens as hasCostcoTokens } from '../services/costcoWebViewBridge';

// [CHANGED from Phase 4] Default is always-on; SYNC_AUTO_ENABLED='0' is the kill-switch.
const AUTO_SYNC_KILL_SWITCH = '0';
const DEFAULT_MIN_RESYNC_MS = 4 * 60 * 60 * 1000; // 4 hours
const DEBOUNCE_MS = 1000;
const MOUNT_DELAY_MS = 250; // let auth context settle

/**
 * Mounts app lifecycle listeners and triggers silent sync per provider when
 * appropriate. Must be mounted exactly once at the app root.
 *
 * @param {object} opts
 * @param {string|null} opts.userId
 */
export function useAppSyncScheduler({ userId }) { /* ... */ }
```

**`isAutoEnabled()` helper (module-private):**

```js
// [CHANGED from Phase 4] Auto-sync is on unless SYNC_AUTO_ENABLED is explicitly '0'.
function isAutoEnabled() {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem('SYNC_AUTO_ENABLED') !== AUTO_SYNC_KILL_SWITCH;
}
```

**Hook body (identical structure to Phase 4, kill-switch logic changed):**

1. If `!Capacitor.isNativePlatform()`, hook is a no-op.
2. If `!isAutoEnabled()`, hook is a no-op. Re-check on every scheduled trigger.
3. On mount (when `userId` becomes non-null), run `maybeSyncAllProviders()` once after `MOUNT_DELAY_MS`.
4. Register `CapacitorApp.addListener('appStateChange', ({isActive}) => ...)`. On `isActive === true`, debounce-call `maybeSyncAllProviders()`.
5. Debounce: collapse multiple lifecycle events within `DEBOUNCE_MS` into one run.
6. Unsubscribe on unmount; cancel the mount-delay timer.

**`maybeSyncAllProviders()` (identical to Phase 4):**

```js
async function maybeSyncAllProviders() {
  if (!userId) return;
  const providers = [
    { name: 'safeway', hasTokens: hasSafewayTokens, run: runSafewaySilentSync },
    { name: 'costco',  hasTokens: hasCostcoTokens,  run: runCostcoSilentSync  },
  ];
  for (const p of providers) {
    try {
      if (!(await p.hasTokens())) continue;
      if (!(await shouldRun(p.name))) continue;
      dispatchEvent(p.name, 'started');
      const result = await p.run(userId);
      dispatchOutcomeEvent(p.name, result);
    } catch (err) {
      dispatchEvent(p.name, 'error', { message: err?.message });
    }
  }
}
```

**`shouldRun(provider)` (identical to Phase 4):**

```js
async function shouldRun(provider) {
  const { minResyncMsOverride } = readFlags();
  const threshold = minResyncMsOverride ?? DEFAULT_MIN_RESYNC_MS;
  const { value } = await Preferences.get({ key: `sync_lastRun_${provider}` });
  const last = value ? Number(value) : 0;
  return Date.now() - last >= threshold;
}
```

**`dispatchOutcomeEvent(provider, result)` mapping (identical to Phase 4):**

| Orchestrator `result.outcome` | Dispatched event | Side effect |
|---|---|---|
| `'synced'` | `<provider>-sync-completed` with `detail = {tier, receipts_stored, items_added}` | Write `sync_lastRun_<provider>` = `String(Date.now())` |
| `'skipped'` | `<provider>-sync-skipped` | — |
| `'needs_reconnect'` | `<provider>-sync-needs-reconnect` | — (**do not** update `sync_lastRun`; let 01a's `ReconnectBanner` handle UI) |
| `'error'` | `<provider>-sync-error` with `detail = {message}` | — |

All events via `window.dispatchEvent(new CustomEvent(type, { detail }))`.

**`runSafewaySilentSync` / `runCostcoSilentSync` import note:** If these named exports do not yet exist on the bridge modules (they are part of silent_sync Phases 2–3), the hook should import the closest equivalent (`startSilentSync` from the respective bridge) and wrap it in a thin adapter that normalises the outcome to `{ outcome: 'synced' | 'needs_reconnect' | 'skipped' | 'error', ... }`. The adapter lives inside `useAppSyncScheduler.js` only, not in the bridge. Add a `// TODO: replace with runSafewaySilentSync once silent_sync Phase 3 is merged` comment.

---

### Phase 01b.2 — App-root wiring

**File:** `frontend/src/App.jsx` (modified — confirm the exact component name during implementation)

```jsx
import { useAppSyncScheduler } from './hooks/useAppSyncScheduler';

function App() {
  const { user } = useAuth();  // existing auth context
  useAppSyncScheduler({ userId: user?.id ?? null });
  // ... rest of App.jsx unchanged ...
}
```

Gate: 01b.1 must be complete (hook exists and tests pass) before 01b.2 is implemented.

**Verification:** `rg 'useAppSyncScheduler'` must show exactly two matches outside test files: the import and the call site in `App.jsx`.

---

## Logic Guardrails

- **Default-on / kill-switch semantics.** `SYNC_AUTO_ENABLED` absent or any value other than `'0'` → scheduler runs. `SYNC_AUTO_ENABLED=0` → scheduler is a complete no-op. Re-check the flag on every trigger (it may be toggled at runtime for QA).
- **No-op off-native.** `Capacitor.isNativePlatform() === false` short-circuits the hook entirely. Web builds remain unaffected.
- **Never fire sync without a `userId`.** A `null` or `undefined` userId must skip the whole run, not throw.
- **Per-provider token gate.** Skip a provider whose `hasStoredTokens()` returns false. Do not trigger any login flow automatically.
- **Per-provider throttle.** `sync_lastRun_<provider>` key in `Preferences` (integer ms). `SYNC_MIN_RESYNC_MS_OVERRIDE` from `readFlags()` takes precedence over the 4h default. A `0` override means "always run" (useful for dev/QA).
- **`sync_lastRun_<provider>` written only on `'synced'` outcomes.** `needs_reconnect`, `skipped`, and `error` must not update it — a failed or reconnect-needed sync must not starve the next attempt.
- **Sequential providers, not parallel.** Run Safeway then Costco. Avoid racing two InAppBrowser instances.
- **Exactly one in-flight sync per provider.** Use a `syncingRef` object `{ safeway: false, costco: false }` per hook instance; skip a provider if it is already in-flight.
- **On `needs_reconnect`, stop retrying.** The `sync_lastRun` key is not written, so the next foreground will re-attempt — but `ReconnectBanner` (01a) is already visible. Do not emit `sync-started` again for a provider whose banner is already visible (the scheduler cannot know banner state; this is enforced by the throttle + the `needs_reconnect` outcome skipping lastRun writes).
- **Debounce rapid lifecycle events.** Android sometimes fires `appStateChange` multiple times within 1s; coalesce to one `maybeSyncAllProviders()` call using a `debounceRef` timer.
- **`appStateChange` with `isActive: false` is ignored.** Only `isActive === true` triggers a run.
- **Every run dispatches `started` before awaiting, and exactly one outcome event after.** Errors caught in the catch block dispatch `<provider>-sync-error`; they never bubble out of the hook.
- **No network calls from the hook itself.** All fetching is delegated to `runSafewaySilentSync` / `runCostcoSilentSync` (or their adapters).
- **No PII in telemetry or log output.** Pass any sensitive values through `redact()` from `syncDebugFlags.js` before logging.
- **Mount exactly once.** Do not call `useAppSyncScheduler` from any component other than the app root. Adding it to `Providers.jsx` or any page component would create duplicate scheduler instances.
- **No changes to bridge files or `silentSyncOrchestrator.js`.** If a bridge change seems necessary, stop and create a new pre-phase brief.

---

## Test-First Suite

### `frontend/src/hooks/__tests__/useAppSyncScheduler.test.js` (new)

Mock `@capacitor/app`, `@capacitor/core`, `@capacitor/preferences`, `../services/syncDebugFlags`, `../services/safewayWebViewBridge`, `../services/costcoWebViewBridge`. Use `renderHook` from `@testing-library/react`.

```
NOOP_OFF_NATIVE
  - Capacitor.isNativePlatform returns false; assert no listeners registered, no runs.

NOOP_WHEN_KILL_SWITCH_ON
  - localStorage.SYNC_AUTO_ENABLED = '0'; assert CapacitorApp.addListener not called.

AUTO_ENABLED_WHEN_FLAG_ABSENT
  - localStorage has no SYNC_AUTO_ENABLED key; assert maybeSyncAllProviders runs
    (integration: scheduler is not suppressed).

AUTO_ENABLED_WHEN_FLAG_IS_1
  - localStorage.SYNC_AUTO_ENABLED = '1'; assert scheduler runs (flag='1' is NOT the kill-switch).

NOOP_WHEN_USER_ID_NULL
  - Kill-switch off, native, userId null; assert no provider run.

RUNS_ON_MOUNT_AFTER_AUTH_SETTLED
  - Kill-switch off, native, userId present, both hasStoredTokens return true;
    assert runSafewaySilentSync called once after MOUNT_DELAY_MS.

RUNS_ON_APP_STATE_ACTIVE_TRUE
  - Simulate appStateChange({isActive: true}); assert provider run triggered.

DOES_NOT_RUN_ON_APP_STATE_INACTIVE
  - Simulate appStateChange({isActive: false}); assert no run.

DEBOUNCES_RAPID_APP_STATE_EVENTS
  - Fire appStateChange three times within DEBOUNCE_MS; assert exactly one run.

SKIPS_WHEN_THROTTLE_NOT_EXPIRED
  - Preferences returns sync_lastRun_safeway = now - 30min (threshold 4h);
    assert runSafewaySilentSync NOT called for safeway.
    Assert runCostcoSilentSync IS called if costco has no recent lastRun.

MIN_RESYNC_OVERRIDE_ZERO_ALWAYS_RUNS
  - readFlags returns minResyncMsOverride = 0; sync_lastRun = now;
    assert run still triggers.

SKIPS_PROVIDER_WITHOUT_STORED_TOKENS
  - hasSafewayTokens returns false; assert only Costco runs.

WRITES_SYNC_LAST_RUN_ON_SYNCED_OUTCOME
  - runSafewaySilentSync resolves {outcome:'synced'};
    assert Preferences.set({key:'sync_lastRun_safeway', value: <now>}) called.

DOES_NOT_WRITE_LAST_RUN_ON_NEEDS_RECONNECT
  - runSafewaySilentSync resolves {outcome:'needs_reconnect'};
    assert Preferences.set NOT called for safeway.

DOES_NOT_WRITE_LAST_RUN_ON_SKIPPED
  - runSafewaySilentSync resolves {outcome:'skipped'};
    assert Preferences.set NOT called.

DOES_NOT_WRITE_LAST_RUN_ON_ERROR_OUTCOME
  - runSafewaySilentSync resolves {outcome:'error'};
    assert Preferences.set NOT called.

DISPATCHES_STARTED_THEN_COMPLETED_IN_ORDER
  - Spy on window.dispatchEvent; assert safeway-sync-started fires before
    safeway-sync-completed; assert no duplicate started events.

DISPATCHES_NEEDS_RECONNECT_EVENT
  - outcome 'needs_reconnect'; assert safeway-sync-needs-reconnect dispatched.

DISPATCHES_ERROR_EVENT_ON_THROW
  - runSafewaySilentSync throws; assert safeway-sync-error dispatched with
    detail.message; hook does not throw or crash.

DISPATCHES_SKIPPED_EVENT
  - outcome 'skipped'; assert safeway-sync-skipped dispatched.

SEQUENTIAL_NOT_PARALLEL
  - Arrange both provider runs with incrementing timestamps; assert costco does
    not start until safeway resolves.

IN_FLIGHT_GUARD_SKIPS_CONCURRENT_TRIGGER
  - runSafewaySilentSync is slow (unresolved promise); trigger a second
    appStateChange; assert runSafewaySilentSync called exactly once (not twice).

LISTENERS_REMOVED_ON_UNMOUNT
  - Render hook, unmount; fire appStateChange; assert no runs after unmount.

KILL_SWITCH_RE_CHECKED_AT_RUNTIME
  - Start with kill-switch off; mid-test set localStorage.SYNC_AUTO_ENABLED = '0';
    simulate next appStateChange; assert no run.
```

### App-root integration (01b.2)

No dedicated new test file. Verify in the existing `App.test.jsx` (or create `frontend/src/__tests__/App.test.jsx` if absent):

```
SCHEDULER_MOUNTED_AT_ROOT
  - Render App with mocked AuthContext (user present); assert useAppSyncScheduler
    is invoked with userId equal to user.id.

SCHEDULER_NOT_MOUNTED_ELSEWHERE
  - Static check: rg 'useAppSyncScheduler' in src/ (excluding hooks/ and __tests__/)
    must return exactly one match (App.jsx).
```

---

## Definition of Done

- [ ] `frontend/src/hooks/useAppSyncScheduler.js` exists; default-on kill-switch semantics implemented as specified.
- [ ] Hook is mounted exactly once at the app root (`App.jsx`).
- [ ] `SYNC_AUTO_ENABLED=0` suppresses the scheduler; absent/any-other-value → runs.
- [ ] On app foreground, both providers are attempted sequentially when tokens exist and throttle is cleared.
- [ ] `sync_lastRun_<provider>` written only on `'synced'` outcome.
- [ ] `<provider>-sync-started | -completed | -skipped | -needs-reconnect | -error` events dispatched in the correct order for each outcome.
- [ ] On `needs_reconnect`, `ReconnectBanner` (01a) auto-surfaces without any additional wiring in this brief.
- [ ] All new vitest suites pass; no existing test regressions.
- [ ] `rg 'useAppSyncScheduler'` outside test/hook files shows exactly one call site (`App.jsx`).
- [ ] On-device smoke test (iOS or Android, `SYNC_MIN_RESYNC_MS_OVERRIDE=0`): close and reopen app; observe sync fires; confirm `ReconnectBanner` appears if tokens are expired; confirm banner clears on successful re-sync.
- [ ] On-device smoke test: with recent `sync_lastRun` (< 4h), reopen app; confirm scheduler skips the synced provider.
- [ ] With `SYNC_AUTO_ENABLED=0`, confirm behavior is identical to the state before this brief (no scheduler activity).
- [ ] No new ESLint errors in touched files.
- [ ] **01b depends on 01a being merged first.** Do not begin 01b.2 (app-root wiring) until 01a's `ReconnectBanner` is live.
- [ ] Logic Audit report: each bullet in "Logic Guardrails" mapped to a test case or verified code location.
