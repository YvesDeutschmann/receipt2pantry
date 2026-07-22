# MVP Gap 01a — Reconnect UX

> **Prerequisite:** Brief `00-scope-lock-cleanup.md` is complete and merged. The deferred-surface cleanup (multi-chain cards, voice-cooking entry points) is done so the Providers page only renders Safeway and Costco.
>
> **Scope:** Frontend only. Three production files modified or created, plus vitest test files. No backend changes.
>
> **Do NOT touch in this phase:** `useSafewaySync.js`, `useCostcoSync.js`, `useCostcoAutoSync.js`, any service module in `frontend/src/services/`, any backend file, `useAppSyncScheduler.js` (that is 01b).

---

## Objective

When a store's credentials, cookies, or tokens expire, the user sees a plain-language **"Reconnect \<Store\>"** prompt instead of a silent failure or a cryptic error string. This brief adds the subscription to provider sync signals, a `ReconnectBanner` component, and the wiring into `SafewayConnectCard` and `CostcoOneTapSync`. After this brief ships, any code that fires `<provider>-sync-needs-reconnect` or `<provider>-sync-error` (including the auto-sync scheduler in 01b) will automatically surface a human-readable, actionable reconnect prompt to the user.

---

## Technical Contract

### 1. `frontend/src/components/ReconnectBanner.jsx` (new)

A small, self-contained presentational + behavioural component. It subscribes to `<provider>-sync-needs-reconnect` and backend `expired_credentials` signals and surfaces a dismissable amber banner.

```jsx
/**
 * Props:
 *   provider:         'safeway' | 'costco'
 *   onReconnect:      () => void  — calls the provider's startSync (connect flow)
 *   storeName:        string      — display label, e.g. "Safeway", "Costco"
 *   testForceVisible?: boolean    — for unit tests only; forces banner shown
 */
export default function ReconnectBanner({ provider, onReconnect, storeName, testForceVisible }) { /* ... */ }
```

**Internal state:**

```js
const [visible, setVisible] = useState(testForceVisible ?? false);
const [dismissed, setDismissed] = useState(false);
```

**Signal subscriptions (via `useEffect`):**

- `window.addEventListener(`${provider}-sync-needs-reconnect`, show)` — sets `visible = true`, `dismissed = false`.
- `window.addEventListener(`${provider}-sync-completed`, hide)` — sets `visible = false`.
- `window.addEventListener(`${provider}-sync-error`, onSyncError)` — calls `classifyError(e.detail?.message)`; shows banner only when `classifyError` returns `'expired'` (see Logic Guardrails). Transient network errors must not show the banner.

Both listeners are cleaned up on unmount.

**`classifyError(message: string | undefined): 'expired' | 'transient' | 'unknown'`** (module-private helper):

| Matches (case-insensitive regex) | Returns |
|---|---|
| `/session.?expired\|token.?expired\|token.?invalid\|credentials.?expired\|401\|403\|forbidden\|unauthorized/` | `'expired'` |
| `/network\|timeout\|fetch.?failed\|connection.?refused\|offline/` | `'transient'` |
| anything else | `'unknown'` |

**Banner UI (only rendered when `visible && !dismissed`):**

```jsx
<div role="alert" aria-live="assertive" className="alert alert-warning flex items-start justify-between gap-3">
  <p className="text-sm font-medium">
    Your {storeName} session expired. Tap <strong>Reconnect {storeName}</strong> to sign in again
    and keep your pantry up to date.
  </p>
  <div className="flex gap-2 shrink-0">
    <button type="button" onClick={onReconnect} className="btn btn-primary text-sm py-1 px-3">
      Reconnect {storeName}
    </button>
    <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss" className="btn btn-ghost text-sm p-1">
      ✕
    </button>
  </div>
</div>
```

Copy guidelines:
- Always use the plain store name ("Safeway", "Costco"), never "provider", "credentials", "token", or "session".
- Never expose error codes or raw error messages in the banner copy.
- The dismiss button clears the banner for the current session; it reappears on the next `needs-reconnect` event.

---

### 2. `frontend/src/components/SafewayConnectCard.jsx` (modified)

Add `ReconnectBanner` above the sync buttons. Do not remove or restructure any existing UI.

```jsx
// Add import at top of file
import ReconnectBanner from './ReconnectBanner';

// Inside the native-platform branch of the return, before the <div className="flex flex-wrap gap-3..."> buttons:
<ReconnectBanner
  provider="safeway"
  storeName="Safeway"
  onReconnect={startSync}
/>
```

No new state is needed in `SafewayConnectCard` itself — `ReconnectBanner` owns its own visibility state.

---

### 3. `frontend/src/components/CostcoOneTapSync.jsx` (modified)

Same pattern as Safeway:

```jsx
// Add import at top of file
import ReconnectBanner from './ReconnectBanner';

// Inside the native-platform branch, before the <div className="flex flex-wrap gap-3..."> buttons:
<ReconnectBanner
  provider="costco"
  storeName="Costco"
  onReconnect={startSync}
/>
```

---

### Signal reference (existing, not invented)

These CustomEvents are already documented in `docs/implementation_briefs/silent_sync/README.md` and dispatched by `useAppSyncScheduler` (brief 01b) and the existing sync hooks:

| Event name | `detail` shape | Meaning |
|---|---|---|
| `<provider>-sync-needs-reconnect` | `{}` | Credentials/cookies/tokens are expired; user must reconnect |
| `<provider>-sync-error` | `{ message: string }` | A sync attempt failed with an error |
| `<provider>-sync-completed` | `{ tier, receipts_stored, items_added }` | Sync succeeded; clear any existing banner |
| `<provider>-sync-started` | `{}` | Sync in progress (not used by this brief) |
| `<provider>-sync-skipped` | `{}` | Throttle active (not used by this brief) |

Backend `expired_credentials: true` (from `backend/routes/providers.py` 401 response) is surfaced to the frontend only indirectly via the sync hooks that translate it into a `<provider>-sync-needs-reconnect` or `<provider>-sync-error` event. This brief does not read the backend response directly.

---

## Logic Guardrails

- **Never show the banner for transient network errors.** `classifyError` must return `'transient'` for network/timeout patterns; the banner must not appear in that case. Only `'expired'` triggers the banner from `sync-error`.
- **`needs-reconnect` always shows the banner**, regardless of `classifyError` — that event is unambiguous.
- **Debounce duplicate signals per provider.** If `visible` is already `true` for a provider, a second `needs-reconnect` event must not reset `dismissed` or cause a re-render flash. Guard with `if (visible) return` inside the show handler.
- **`dismissed` persists only until the next `needs-reconnect` event.** On the next `needs-reconnect`, reset `dismissed = false` and `visible = true` regardless of whether it was previously dismissed.
- **`sync-completed` clears the banner** even if dismissed; ensures a successful sync always removes the stale prompt.
- **Do not block the rest of the app.** The banner is inline in the connect card; it must not use a modal, overlay, or navigation intercept.
- **Never expose tokens, cookies, or raw error strings** in the banner text or `aria-label` attributes.
- **`onReconnect` calls `startSync`**, which re-launches the full connect flow (WebView login). Do not attempt a silent sync from the reconnect button.
- **Non-native (web/dev) environments:** `ReconnectBanner` still mounts and subscribes to events (useful in dev for smoke-testing). The banner is purely UI and has no native dependencies.
- **`testForceVisible` prop is only for unit tests.** It must not be used in production call sites.

---

## Test-First Suite

All tests live under `frontend/src/components/__tests__/`. Run with `vitest`.

### `ReconnectBanner.test.jsx` (new)

```
BANNER_HIDDEN_BY_DEFAULT
  - Render with no events fired; assert banner not in document.

BANNER_SHOWS_ON_NEEDS_RECONNECT_EVENT
  - Dispatch `safeway-sync-needs-reconnect`; assert banner rendered with "Reconnect Safeway" text.

BANNER_SHOWS_ON_COSTCO_NEEDS_RECONNECT_EVENT
  - Dispatch `costco-sync-needs-reconnect`; assert banner rendered with "Reconnect Costco" text.

BANNER_HIDES_ON_SYNC_COMPLETED_EVENT
  - Show banner (testForceVisible), then dispatch `safeway-sync-completed`; assert banner removed.

BANNER_HIDES_AFTER_DISMISS
  - Show banner (testForceVisible), click dismiss button; assert banner not in document.

BANNER_REAPPEARS_AFTER_DISMISS_ON_NEXT_NEEDS_RECONNECT
  - Show banner, dismiss, then dispatch `safeway-sync-needs-reconnect`; assert banner visible again.

RECONNECT_BUTTON_CALLS_ON_RECONNECT
  - Show banner (testForceVisible); click "Reconnect Safeway"; assert onReconnect called once.

SYNC_ERROR_EXPIRED_PATTERN_SHOWS_BANNER
  - Dispatch `safeway-sync-error` with detail `{message: 'session expired'}`;
    assert banner shown.

SYNC_ERROR_TRANSIENT_DOES_NOT_SHOW_BANNER
  - Dispatch `safeway-sync-error` with detail `{message: 'network timeout'}`;
    assert banner NOT shown.

SYNC_ERROR_UNKNOWN_DOES_NOT_SHOW_BANNER
  - Dispatch `safeway-sync-error` with detail `{message: 'something went wrong'}`;
    assert banner NOT shown.

CLASSIFY_ERROR_EXPIRED_PATTERNS
  - Test classifyError (exported for testing) with:
    'session expired', 'token invalid', 'token expired', 'credentials expired',
    '401', '403', 'unauthorized', 'forbidden' → all return 'expired'.

CLASSIFY_ERROR_TRANSIENT_PATTERNS
  - Test classifyError with: 'network error', 'timeout', 'fetch failed',
    'connection refused', 'offline' → all return 'transient'.

DUPLICATE_NEEDS_RECONNECT_NO_FLASH
  - Show banner (first event); dispatch second `needs-reconnect`; assert
    onReconnect has NOT been called and component rendered only once after first event
    (use renderCount spy or check that dismissed remains false).

BANNER_COPY_EXCLUDES_TECHNICAL_TERMS
  - Render with testForceVisible; assert rendered text does NOT contain
    /token|credential|session|cookie|401|403/i.

NO_CROSS_PROVIDER_INTERFERENCE
  - Render two banners (safeway + costco); dispatch `costco-sync-needs-reconnect`;
    assert only costco banner visible, safeway banner hidden.

LISTENERS_REMOVED_ON_UNMOUNT
  - Render, unmount; dispatch `safeway-sync-needs-reconnect`; assert no errors thrown
    and banner does not re-appear (document is clean).
```

### `SafewayConnectCard.test.jsx` (extended)

Extend the existing test file (create if it does not exist at `frontend/src/components/__tests__/SafewayConnectCard.test.jsx`):

```
RECONNECT_BANNER_MOUNTED_IN_SAFEWAY_CARD
  - Render SafewayConnectCard on native (mock Capacitor.isNativePlatform = true);
    dispatch `safeway-sync-needs-reconnect`; assert ReconnectBanner visible.

RECONNECT_BANNER_CALLS_START_SYNC_IN_SAFEWAY_CARD
  - Banner visible; click "Reconnect Safeway"; assert useSafewaySync.startSync called.
```

### `CostcoOneTapSync.test.jsx` (extended)

```
RECONNECT_BANNER_MOUNTED_IN_COSTCO_CARD
  - Render CostcoOneTapSync on native; dispatch `costco-sync-needs-reconnect`;
    assert ReconnectBanner visible.

RECONNECT_BANNER_CALLS_START_SYNC_IN_COSTCO_CARD
  - Banner visible; click "Reconnect Costco"; assert useCostcoSync.startSync called.
```

---

## Definition of Done

- [ ] `frontend/src/components/ReconnectBanner.jsx` exists with the props contract above.
- [ ] `classifyError` is exported (named export) for unit testing; it is not part of the public component API.
- [ ] `SafewayConnectCard.jsx` renders `<ReconnectBanner provider="safeway" ... />` in the native branch.
- [ ] `CostcoOneTapSync.jsx` renders `<ReconnectBanner provider="costco" ... />` in the native branch.
- [ ] No existing UI in either card is removed or repositioned.
- [ ] All new vitest suites pass (`npm test` in `frontend/`); no existing test regressions.
- [ ] Manual smoke test on device or emulator: manually dispatch `window.dispatchEvent(new CustomEvent('safeway-sync-needs-reconnect'))` in the app; confirm banner appears with plain-language copy; confirm dismiss works; confirm tapping "Reconnect Safeway" opens the Safeway login WebView.
- [ ] Manual smoke test: confirm a successful sync (trigger via "Sync Safeway Receipts" button) clears the banner.
- [ ] Manual smoke test: `window.dispatchEvent(new CustomEvent('safeway-sync-error', {detail:{message:'network timeout'}}))` does NOT show the banner.
- [ ] `rg 'ReconnectBanner'` matches only `SafewayConnectCard.jsx`, `CostcoOneTapSync.jsx`, the component file itself, and test files.
- [ ] No new ESLint errors in touched files.
- [ ] Logic Audit report: each bullet in "Logic Guardrails" marked as verified against a test case or code location.
