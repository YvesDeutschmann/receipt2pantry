# Silent Sync Phase 4 -- Scheduler and UI

> **Prerequisite:** Phases 1, 2, and 3 are complete and merged. `runSafewaySilentSync`, `runCostcoSilentSync`, `syncTelemetry`, and `syncDebugFlags` are wired and tested. On-device validation from Phase 3 passed on at least one platform.
>
> **Scope:** One new hook mounted at the app root to auto-trigger silent sync on foreground; one small dev-only overlay component for live telemetry; UX additions to the Safeway connect card.
>
> **Do NOT touch in this phase:** `silentSyncOrchestrator.js`, any provider bridge, any service module, any backend file. This phase is purely frontend lifecycle + UI.

---

## Objective

Automate silent sync so it runs on app foreground/resume without user intervention, gated behind a feature flag so it can ship "dark" and be flipped on. Surface useful feedback to the user (`Last synced N min ago`, `Reconnect Safeway` banner) and provide a developer-only overlay for inspecting telemetry in real time.

After Phase 4, with `SYNC_AUTO_ENABLED=1`:
- Opening the app after the throttle window triggers a background silent sync.
- The UI reflects the last sync time and surfaces a reconnect prompt when the cascade ends in `needs_reconnect`.

With `SYNC_AUTO_ENABLED=0` (default), behavior is indistinguishable from Phase 3 in production.

---

## Technical Contract

### 1. `frontend/src/hooks/useAppSyncScheduler.js` (new)

```js
import { useEffect, useRef } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { readFlags } from '../services/syncDebugFlags';
import { runSafewaySilentSync } from '../services/safewayWebViewBridge';
import { runCostcoSilentSync } from '../services/costcoWebViewBridge';
import { hasStoredTokens as hasSafewayTokens } from '../services/safewayWebViewBridge';
import { hasStoredTokens as hasCostcoTokens } from '../services/costcoWebViewBridge';

const DEFAULT_MIN_RESYNC_MS = 4 * 60 * 60 * 1000; // 4h
const DEBOUNCE_MS = 1000;

/**
 * Mounts app lifecycle listeners and triggers runSilentSync per provider when appropriate.
 * Must be mounted exactly once near the app root.
 *
 * @param {object} opts
 * @param {string|null} opts.userId
 */
export function useAppSyncScheduler({ userId }) { /* ... */ }
```

Behavior:

1. If `!Capacitor.isNativePlatform()`, the hook is a no-op.
2. If `readFlags().autoEnabled !== true`, the hook is a no-op. Re-check on every scheduled trigger (flag may be toggled at runtime).
3. On mount (when `userId` becomes non-null), run `maybeSyncAllProviders()` once after a short (250ms) delay to let auth settle.
4. Register `CapacitorApp.addListener('appStateChange', ({isActive}) => ...)`. On `isActive === true`, call `maybeSyncAllProviders()`.
5. Debounce: collapse multiple lifecycle events within `DEBOUNCE_MS` into one run.
6. Unsubscribe on unmount.

`maybeSyncAllProviders()`:

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

async function shouldRun(provider) {
  const { minResyncMsOverride } = readFlags();
  const threshold = minResyncMsOverride ?? DEFAULT_MIN_RESYNC_MS;
  const { value } = await Preferences.get({ key: `sync_lastRun_${provider}` });
  const last = value ? Number(value) : 0;
  return Date.now() - last >= threshold;
}
```

`dispatchOutcomeEvent(provider, result)` maps `result.outcome`:

| Orchestrator outcome | Event type |
|---|---|
| `'synced'` | `<provider>-sync-completed` with `detail = {tier, receipts_stored, items_added}` + writes `sync_lastRun_<provider>` = now |
| `'skipped'` | `<provider>-sync-skipped` |
| `'needs_reconnect'` | `<provider>-sync-needs-reconnect` |
| `'error'` | `<provider>-sync-error` with `detail = {message}` |

All events dispatched via `window.dispatchEvent(new CustomEvent(type, {detail}))`.

### 2. `frontend/src/components/SyncTelemetryOverlay.jsx` (new, dev-only)

```jsx
/**
 * Developer-only overlay rendering the current telemetry snapshot for a provider.
 * Hidden unless SYNC_TELEMETRY_DEV_PANEL=1 in localStorage.
 *
 * Props:
 *   provider: 'safeway' | 'costco'
 */
export default function SyncTelemetryOverlay({ provider }) { /* ... */ }
```

Renders (only when flag is on):
- Compact card fixed to bottom-right with the telemetry blob fields.
- A "Reset" button that calls `syncTelemetry.reset(provider)` and re-reads.
- Refreshes every 5s via `setInterval` while mounted; also refreshes when any `<provider>-sync-*` event fires.
- Styling via existing Tailwind utility classes; no new design tokens.

### 3. `frontend/src/components/SafewayConnectCard.jsx` (modified)

Add (do not remove any existing UI):

```jsx
// Inside the component body, read meta on mount + whenever a sync completes:
const [lastSyncAt, setLastSyncAt] = useState(null);
const [needsReconnect, setNeedsReconnect] = useState(false);

useEffect(() => {
  let cancelled = false;
  const refresh = async () => {
    const meta = await tokenStorage.getMeta();  // or expose via bridge
    if (!cancelled) setLastSyncAt(meta?.lastSyncAt ? Number(meta.lastSyncAt) : null);
  };
  refresh();
  const onCompleted = () => { setNeedsReconnect(false); refresh(); };
  const onReconnect = () => setNeedsReconnect(true);
  window.addEventListener('safeway-sync-completed', onCompleted);
  window.addEventListener('safeway-sync-needs-reconnect', onReconnect);
  return () => {
    cancelled = true;
    window.removeEventListener('safeway-sync-completed', onCompleted);
    window.removeEventListener('safeway-sync-needs-reconnect', onReconnect);
  };
}, []);
```

UI additions:

- Below the sync buttons, when `lastSyncAt` is non-null: small muted text `Last synced {formatRelative(lastSyncAt)}`. Use `date-fns` `formatDistanceToNowStrict` (already a dependency).
- When `needsReconnect` is true: a prominent amber banner above the buttons with text `Safeway session expired. Tap Connect Safeway to reconnect.` and a button that calls `startSync`.
- The banner must be dismissable (X button) and reappear only after the next `needs_reconnect` event.

A new helper is needed to read meta on the client side. Either:
(a) export `getSafewayMeta()` from `safewayWebViewBridge.js` that returns `tokenStorage.getMeta()`, or
(b) use the same dynamic import pattern already used elsewhere.

Prefer (a). Add that single-line export to the bridge file.

Apply equivalent additions to the Costco connect card / `CostcoOneTapSync.jsx` (if it already has a sync button) -- otherwise leave Costco UI untouched and note it in the PR description.

### 4. App root mounting

Locate the existing top-level React component (likely `frontend/src/App.jsx` -- confirm during implementation). Add:

```jsx
import { useAppSyncScheduler } from './hooks/useAppSyncScheduler';

function App() {
  const { user } = useAuth();  // use the existing auth context
  useAppSyncScheduler({ userId: user?.id ?? null });
  // ... rest unchanged ...
}
```

Mount `SyncTelemetryOverlay` on the Providers page ([frontend/src/pages/Providers.jsx](../../../frontend/src/pages/Providers.jsx)):

```jsx
import SyncTelemetryOverlay from '../components/SyncTelemetryOverlay';
// inside render:
<SyncTelemetryOverlay provider="safeway" />
<SyncTelemetryOverlay provider="costco" />
```

The overlay internally guards on the flag; unconditional mounting is safe.

---

## Logic Guardrails

- **Flag-off is a full no-op.** With `SYNC_AUTO_ENABLED !== '1'`, `useAppSyncScheduler` must not register any listeners or make any calls. The only allowed work is the `readFlags()` call itself.
- **No-op off-native.** `Capacitor.isNativePlatform() === false` short-circuits the hook (web builds see nothing).
- **Never fire sync without a userId.** A null userId must skip the whole run, not throw.
- **Per-provider gating:** skip a provider whose `hasStoredTokens()` is false. Do not invite a login automatically.
- **Per-provider throttling:** enforce `sync_lastRun_<provider>` via Preferences. `SYNC_MIN_RESYNC_MS_OVERRIDE` takes precedence over the default 4h.
- **Throttle key is written only on `'synced'`** outcomes. `skipped` and `needs_reconnect` must not update `sync_lastRun_*` (so a transient failure does not starve the next attempt).
- **Sequential providers, not parallel.** Run Safeway then Costco. This avoids racing two InAppBrowser instances in Tier 3.
- **`appStateChange` with `isActive: false` is ignored.** Only `true` triggers sync.
- **Debounce rapid lifecycle events.** If `appStateChange` fires multiple times within 1s (known on Android), coalesce to one `maybeSyncAllProviders` call.
- **Event dispatching is synchronous**: every run dispatches `started` before awaiting, and exactly one outcome event after. Errors caught in the hook dispatch `<provider>-sync-error` (never bubble out).
- **UI reads meta via the bridge's `getMeta()`**, never directly from `localStorage`/`Preferences` keys. This keeps storage details encapsulated.
- **Overlay is gated at render time**, not just at mount. Toggling `SYNC_TELEMETRY_DEV_PANEL` at runtime shows/hides the overlay on next render (a periodic tick already exists via the 5s refresh).
- **Reconnect banner must not auto-dismiss.** It persists until the user either taps reconnect (triggering `startSync`) or explicitly dismisses.
- **No network calls from the hook itself.** All fetching goes through `runSafewaySilentSync` / `runCostcoSilentSync` which own their own networking.
- **No changes to `silentSyncOrchestrator.js` or provider bridges.** If you find yourself needing to, stop and re-evaluate -- the abstraction leak belongs in a pre-Phase 4 fix, not here.

---

## Test-First Suite

### `frontend/src/hooks/__tests__/useAppSyncScheduler.test.js` (new)

Mock `@capacitor/app`, `@capacitor/core`, `@capacitor/preferences`, `../services/syncDebugFlags`, `../services/safewayWebViewBridge`, `../services/costcoWebViewBridge`. Use `renderHook` from `@testing-library/react`.

- `NOOP_OFF_NATIVE` -- `Capacitor.isNativePlatform` returns false; assert no listeners added, no runs.
- `NOOP_WHEN_AUTO_DISABLED` -- flag off; assert `CapacitorApp.addListener` not called.
- `NOOP_WHEN_USER_ID_NULL` -- flag on but `userId: null`; assert no runs.
- `RUNS_ON_MOUNT_AFTER_AUTH_SETTLED` -- flag on, userId present, tokens stored; assert `runSafewaySilentSync` called once after the 250ms delay.
- `RUNS_ON_APP_STATE_ACTIVE_TRUE` -- simulate `appStateChange({isActive:true})` after mount; assert call.
- `DOES_NOT_RUN_ON_APP_STATE_INACTIVE` -- `isActive:false`; assert no call.
- `DEBOUNCES_RAPID_EVENTS` -- 3 events within 500ms; assert exactly one run.
- `SKIPS_WHEN_THROTTLE_NOT_EXPIRED` -- Preferences returns `sync_lastRun_safeway = now - 30min`, threshold 4h; assert `runSafewaySilentSync` NOT called for Safeway but still called for Costco if Costco has no recent run.
- `OVERRIDE_RESPECTS_MIN_RESYNC_MS_OVERRIDE` -- flag override = 0; assert sync runs despite recent lastRun.
- `SKIPS_PROVIDER_WITHOUT_STORED_TOKENS` -- `hasSafewayTokens` returns false; only Costco runs.
- `WRITES_SYNC_LAST_RUN_ON_SYNCED` -- mock `runSafewaySilentSync` returns `{outcome:'synced'}`; assert `Preferences.set({key:'sync_lastRun_safeway', value: <now>})`.
- `DOES_NOT_WRITE_LAST_RUN_ON_SKIPPED_OR_NEEDS_RECONNECT`.
- `DISPATCHES_STARTED_AND_COMPLETED_EVENTS` -- spy on `window.dispatchEvent`; assert event types in order.
- `DISPATCHES_NEEDS_RECONNECT_EVENT` -- mock outcome; assert event.
- `DISPATCHES_ERROR_EVENT_ON_THROW` -- `runSafewaySilentSync` throws; assert `safeway-sync-error` dispatched with message; hook does not throw out.
- `SEQUENTIAL_PROVIDERS_NOT_PARALLEL` -- arrange both provider runs with incrementing timestamps; assert Costco does not start until Safeway resolves.

### `frontend/src/components/__tests__/SafewayConnectCard.test.jsx` (new or extended)

- `RENDERS_LAST_SYNC_AT_WHEN_META_PRESENT` -- mock `getSafewayMeta` returning `{lastSyncAt: <now - 10min>}`; assert element with "Last synced 10 minutes ago" (allow for date-fns phrasing).
- `HIDES_LAST_SYNC_AT_WHEN_META_NULL`.
- `SHOWS_RECONNECT_BANNER_ON_EVENT` -- dispatch `safeway-sync-needs-reconnect`; assert banner rendered.
- `HIDES_BANNER_AFTER_SUCCESSFUL_SYNC` -- dispatch `safeway-sync-completed`; banner disappears.
- `BANNER_DISMISS_BUTTON_HIDES_BANNER`.
- `BANNER_RECONNECT_BUTTON_CALLS_START_SYNC`.

### `frontend/src/components/__tests__/SyncTelemetryOverlay.test.jsx` (new)

- `HIDDEN_WHEN_FLAG_OFF`.
- `RENDERS_TELEMETRY_WHEN_FLAG_ON` -- mock `syncTelemetry.read` return; assert key fields rendered.
- `RESET_BUTTON_CALLS_RESET_AND_REFRESHES` -- assert `syncTelemetry.reset` called; re-read triggered.
- `REFRESHES_ON_SYNC_EVENT` -- dispatch `safeway-sync-completed`; overlay re-reads.

### On-device validation (manual, gated by reviewer)

Perform on iOS and Android with `SYNC_AUTO_ENABLED=1`, `SYNC_TIER_TRACE=1`, `SYNC_TELEMETRY_DEV_PANEL=1`.

- [ ] App cold start with recent `sync_lastRun_safeway` -> scheduler skips Safeway (visible in overlay; no trace output); Costco still attempted if connected.
- [ ] App cold start with stale `sync_lastRun_safeway` (or `SYNC_MIN_RESYNC_MS_OVERRIDE=0`) -> scheduler runs Tier 2; overlay counters advance; `Last synced just now` appears in Safeway card.
- [ ] Background -> foreground triggers another run (respecting throttle).
- [ ] Kill app mid-sync -> no crash; next launch cleanly runs.
- [ ] Force Tier 3 by expiring tokens server-side -> observe `t3.attempt` in overlay; if still fails, reconnect banner renders in the Safeway card.
- [ ] Dismiss reconnect banner -> it stays dismissed until next `needs_reconnect` event.
- [ ] Tap reconnect -> existing `startSync` login flow runs; on success, banner clears and telemetry resets `failureReasons`.
- [ ] With `SYNC_AUTO_ENABLED=0`, confirm behavior identical to Phase 3.

---

## Definition of Done

- [ ] `frontend/src/hooks/useAppSyncScheduler.js` exists and is mounted at the app root exactly once.
- [ ] With `SYNC_AUTO_ENABLED=0` (default), zero observable behavior change vs. Phase 3.
- [ ] With `SYNC_AUTO_ENABLED=1`, foreground triggers silent sync per provider, throttled and gated per the contract.
- [ ] `sync_lastRun_<provider>` is written only on `'synced'` outcomes.
- [ ] `<provider>-sync-started | -completed | -skipped | -needs-reconnect | -error` events dispatched as specified.
- [ ] `SyncTelemetryOverlay.jsx` renders under the `SYNC_TELEMETRY_DEV_PANEL` flag; Reset works.
- [ ] `SafewayConnectCard.jsx` shows `Last synced N min ago` and a reconnect banner on `needs_reconnect`.
- [ ] All new vitest suites pass; no existing test regressions.
- [ ] On-device checklist above completed on at least one platform; results pasted into the PR description.
- [ ] `rg 'useAppSyncScheduler'` shows mount only at the app root plus its test file.
- [ ] No new ESLint errors.
- [ ] Logic Audit: each bullet in "Logic Guardrails" mapped to a test case or code location.
