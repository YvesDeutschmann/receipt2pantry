# MVP Gap 01d — Sync Feedback Surfaces (Toast + Dashboard Attention)

> **Superseded (07.3):** `NeedsAttentionSection` render host moved from Dashboard to [`Recipes.jsx`](../../../frontend/src/pages/Recipes.jsx) (`variant="slim"`). Store contract unchanged; only the mount point moved.
>
> **Prerequisite:** Brief `01b-foreground-auto-sync.md` is complete and merged. `useAppSyncScheduler` dispatches `<provider>-sync-completed|needs-reconnect|error` events at the app root.
>
> **Scope:** Frontend only. Split into two sub-phases: **01d.1** (attention store + toast host) and **01d.2** (Dashboard section). No backend changes.
>
> **Do NOT touch in this phase:** `useAppSyncScheduler.js`, provider bridges, manual sync hooks (`useSafewaySync`, `useCostcoSync`), `ReconnectBanner.jsx`, `SafewayConnectCard.jsx`, `CostcoOneTapSync.jsx`, or any backend file.

---

## Objective

Foreground auto-sync (01b) emits sync outcome events, but users have no day-to-day feedback unless they visit Providers. This brief adds:

1. **Selective toasts** — success when `items_added > 0`; reconnect and transient failures when something goes wrong.
2. **Persisted Dashboard attention** — a "Needs attention" section on the home tab for unresolved reconnect items.

The Providers `ReconnectBanner` (01a) remains a secondary surface when already on Providers.

---

## Product rules (locked)

| Outcome | Toast | Dashboard attention |
|---|---|---|
| `completed` + `items_added > 0` | Yes — "Added N items from {Store}" | No |
| `completed` + `items_added === 0` | No | No (and clear any prior reconnect item) |
| `needs-reconnect` or auth-expired `error` | Yes — "{Store} needs reconnect" | Yes — persist until successful sync |
| Transient `error` | Yes — short failure message | No |
| Other `error` | Yes — short failure message | No |

- **Split listen vs toast:** Attention store writes run from an `AppRoutes`-level listener (same level as the scheduler), including during onboarding. Toast UI mounts only in `AppShell` (main authenticated app). No snackbars on `/onboarding/*`.
- **Toasts are edge-triggered:** Only fire when a provider's outcome *changes* (e.g. `ok → needs_reconnect`). A provider stuck in `needs_reconnect` must toast once, not on every app open.
- Persist via Capacitor `Preferences` key `sync_attention`, not backend / `grocery_accounts`.

---

## Technical Contract

### Phase 01d.1 — Attention store + toast host

#### 1. `frontend/src/services/providerAttentionStore.js` (new)

```js
export const PROVIDER_LABELS = { safeway: 'Safeway', costco: 'Costco' };

/** @typedef {{ kind: 'needs_reconnect', updatedAt: number }} AttentionItem */

/**
 * @returns {Promise<Record<string, AttentionItem>>}
 */
export async function getAttention() { /* ... */ }

/**
 * @param {'safeway' | 'costco'} provider
 */
export async function setNeedsReconnect(provider) { /* ... */ }

/**
 * @param {'safeway' | 'costco'} provider
 */
export async function clearProvider(provider) { /* ... */ }

/**
 * @param {(items: Record<string, AttentionItem>) => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribe(listener) { /* ... */ }
```

- Preferences key: `sync_attention` — JSON map `{ safeway?: AttentionItem, costco?: AttentionItem }`.
- `subscribe` is in-memory pub-sub (module-level `Set`); setters notify listeners after Preferences write.
- `getAttention()` hydrates from Preferences on first call and caches in memory.

#### 2. `frontend/src/hooks/useProviderAttentionSync.js` (new)

Mount **once** in `AppRoutes` (`App.jsx`) next to `useAppSyncScheduler`. Listens for both providers' `completed` / `needs-reconnect` / `error`. Writes Preferences only — **no toast rendering**.

| Event | Action |
|---|---|
| `needs-reconnect` | `setNeedsReconnect(provider)` |
| `error` + `classifyError(message) === 'expired'` | `setNeedsReconnect(provider)` |
| `completed` | `clearProvider(provider)` |
| Other `error` | No store write |

Reuse `classifyError` from `ReconnectBanner.jsx`.

#### 3. `frontend/src/components/SyncToastHost.jsx` (new)

Mount **once** in `AppShell.jsx`. Listens to the same events. Keeps in-memory `lastOutcome` map per provider for edge-triggering.

| Transition | Toast |
|---|---|
| Into `needs_reconnect` / expired | "{Store} needs reconnect" |
| `completed` with `items_added > 0` | "Added N items from {Store}" |
| Into non-expired `error` | "Couldn't refresh {Store} — try again later" |

Reuse `UndoToast` without `onAction`. Latest message only (replace, don't stack). Use `PROVIDER_LABELS` for copy.

#### 4. Wiring

**`App.jsx`:** Add `useProviderAttentionSync()` in `AppRoutes`.

**`AppShell.jsx`:** Render `<SyncToastHost />` at shell root (outside `<main>` so it overlays all pages).

---

### Phase 01d.2 — Dashboard attention section

#### 5. `frontend/src/components/NeedsAttentionSection.jsx` (new)

- Reads `providerAttentionStore` via `subscribe` + `getAttention` and `PROVIDER_LABELS`.
- Renders **only when** ≥1 item.
- **Original (01d):** Place in `Dashboard.jsx` immediately after `PageHeader`, before the "You're all set" block.
- **Current (07.3):** Mount in `Recipes.jsx` immediately after `PageHeader` (`variant="slim"`).
- One row per provider: "{Store} needs reconnect" + CTA `Link` to `/providers`.
- Dismiss (X per row) hides for current component-session only. Does **not** call `clearProvider` or touch Preferences. Row reappears on next Dashboard mount / app relaunch until `*-sync-completed` clears the store.

---

## Logic Guardrails

- **Never drop reconnect signals during onboarding.** The `AppRoutes` listener must run even when `AppShell` is not mounted.
- **No toasts on onboarding screens.** `SyncToastHost` mounts only in `AppShell`.
- **Edge-triggered toasts.** Track `lastOutcome` per provider; do not repeat toasts for the same outcome state.
- **Do not toast empty successful syncs** (`items_added === 0`).
- **Do not toast `started` / `skipped`.**
- **Transient errors toast but do not persist** to the attention store.
- **Dashboard dismiss is session-only.** Preferences item persists until a real `sync-completed` clears it.
- **No PII in toast copy or Preferences.**
- **Providers `ReconnectBanner` unchanged.** This brief adds surfaces; it does not replace 01a.

---

## Test-First Suite

### `frontend/src/services/__tests__/providerAttentionStore.test.js` (new)

```
SET_ON_NEEDS_RECONNECT
  - setNeedsReconnect('safeway'); assert Preferences.set with sync_attention containing safeway item.

CLEAR_ON_COMPLETED
  - set then clearProvider('safeway'); assert safeway removed from stored map.

SUBSCRIBE_NOTIFIES_ON_SET
  - subscribe listener; setNeedsReconnect; assert listener called with updated map.

GET_ATTENTION_HYDRATES_FROM_PREFERENCES
  - Preferences.get returns stored JSON; assert getAttention() returns parsed map.
```

### `frontend/src/hooks/__tests__/useProviderAttentionSync.test.js` (new)

```
SET_ON_NEEDS_RECONNECT_EVENT
  - Dispatch safeway-sync-needs-reconnect; assert setNeedsReconnect called.

CLEAR_ON_COMPLETED_EVENT
  - Dispatch safeway-sync-completed; assert clearProvider called.

EXPIRED_ERROR_SETS_ATTENTION
  - Dispatch safeway-sync-error with expired message; assert setNeedsReconnect called.

TRANSIENT_ERROR_DOES_NOT
  - Dispatch safeway-sync-error with network message; assert setNeedsReconnect NOT called.

ATTENTION_LISTENER_MOUNTED_AT_APPROUTES
  - Render AppRoutes; dispatch event; assert store updated even without AppShell.
```

### `frontend/src/components/__tests__/SyncToastHost.test.jsx` (new)

```
TOAST_ON_ITEMS_ADDED
  - Dispatch completed with items_added=3; assert toast message visible.

NO_TOAST_WHEN_ITEMS_ZERO
  - Dispatch completed with items_added=0; assert no toast.

TOAST_ON_NEEDS_RECONNECT
  - Dispatch needs-reconnect; assert toast with reconnect copy.

TOAST_ON_TRANSIENT_ERROR
  - Dispatch error with network message; assert failure toast.

NO_REPEAT_TOAST_ON_SAME_OUTCOME
  - Two consecutive needs-reconnect events; assert toast shown once.

NO_TOAST_OUTSIDE_APPSHELL
  - SyncToastHost not mounted when only AppRoutes renders; assert no toast element.
```

### `frontend/src/components/__tests__/NeedsAttentionSection.test.jsx` (new)

```
HIDDEN_WHEN_EMPTY
  - getAttention returns {}; assert section not in document.

SHOWS_ROW_FOR_PERSISTED_RECONNECT
  - Store has safeway needs_reconnect; assert row with Safeway copy and Providers link.

CLEARS_WHEN_STORE_CLEARED
  - Subscribe fires empty map; assert section hidden.

DISMISS_HIDES_FOR_SESSION_BUT_PREFERENCE_PERSISTS
  - Dismiss row; assert hidden; remount with same store data; assert row visible again.

CTA_NAVIGATES_TO_PROVIDERS
  - Assert Link href is /providers.
```

---

## Definition of Done

- [ ] `01d-sync-feedback-surfaces.md` and README catalog entry exist.
- [ ] `providerAttentionStore.js` persists reconnect items via `sync_attention` Preferences key.
- [ ] `useProviderAttentionSync` mounted in `AppRoutes`; writes store on sync events.
- [ ] `SyncToastHost` mounted in `AppShell`; selective edge-triggered toasts work.
- [ ] `NeedsAttentionSection` on Dashboard shows persisted reconnect items with Providers CTA.
- [ ] All new vitest suites pass; no existing test regressions.
- [ ] On-device: reconnect during onboarding → Dashboard shows attention after entering main app (no onboarding toast).
- [ ] On-device: reconnect while in main app → toast + Dashboard row; row survives app restart until successful sync.
- [ ] Logic Audit: each guardrail mapped to a test case or verified code location.
