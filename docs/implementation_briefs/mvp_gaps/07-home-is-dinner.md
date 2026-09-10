# MVP Gap 07 — Home is dinner, not "you're all set"

> **Prerequisite:** Brief `01e-import-reliability-gaps.md` is complete (G1–G6 PASS). Import-reliability surfaces stay as-is.
>
> **Scope:** Three sequential sub-phases. **07.1** onboarding payoff (first What's for Dinner tap on last step → `/recipes`). **07.2** receipt stats to Settings. **07.3** Dinner default tab; Dashboard removed; Needs attention on Recipes.
>
> **Do NOT touch in 07.1:** Dashboard, Recipes UI, tab bar, Auth destination, sync mapper/hooks, backend.
>
> **Do NOT touch in 07.2:** tab bar, Auth, OnboardingRoute, Recipes, attention store.
>
> **Do NOT touch in 07.3:** suggestion card visuals, Cooked it, ranking (Track 2); attention store writes; classifier; health row.

---

## Objective

Returning users land on dinner in one tap. Completion copy ("You're all set") and the unlock pulse live only on the last onboarding step. Receipt ledger moves off the primary surface. Dashboard tab is removed; `/recipes` is home.

---

## Product rules (locked)

- First What's for Dinner tap is on the **last onboarding step** (staples for owners, dietary for joiners), with pulse. Tap writes `onboarding_completed_at` and OnboardingRoute ejects to `/recipes`.
- Done / Skip / voice confirm show payoff; **do not** call `complete()` until the payoff tap. Back+Save calls `complete()` without payoff ceremony.
- Returning users: `/recipes` list. No hero CTA, no pulse, no "You're all set" on home.
- Needs attention: slim banner above dinner list (07.3). Same store, copy, `/providers` CTAs.
- Receipt stats: Settings "Your receipts" (07.2). `GET /api/receipts/summary` unchanged.

---

## Technical Contract

### Phase 07.1 — Onboarding payoff

#### `OnboardingContext.jsx`

- `complete()` / `completeJoin()`: set `completionSentRef` **only after** successful `updateUser`; throw on error so payoff CTA can retry.
- `mergeJoinDietary()` (new): dietary merge only; does not call `completeJoin()`.
- `completeJoinDietary` deprecated or split: UI calls `mergeJoinDietary` then shows payoff; `completeJoin()` on tap.

#### `OnboardingPayoffPanel.jsx` (new)

Props: `variant: 'owner' | 'joiner'`, `onComplete: () => Promise<void>`, `submitting`, `error`.

Copy: title `You're all set`; owner body `Your pantry baseline is saved — see what you can cook tonight.`; joiner body `You're in — see what you can cook tonight.`; CTA `What's for Dinner` with `animate-pulse`. No Back.

#### `StaplesTemplate.jsx`

- After confirm/skip/voice: `setShowPayoff(true)`, `fireSuggestionPoolWarmup()`, receipt toast. **No** `complete()`, **no** `navigate`.
- Payoff tap: `await complete()`. OnboardingRoute ejects to `/recipes`.
- Back+Save: `confirmStaples` then `await complete()` (no payoff).

#### `DietaryRestrictions.jsx` (joiners)

- Finish: `mergeJoinDietary()` then `setShowPayoff(true)`. Payoff tap: `await completeJoin()`.

#### `OnboardingRoute.jsx`

- Complete users: `<Navigate to="/recipes" replace />`.

---

### Phase 07.2 — Receipt stats to Settings

#### `ReceiptSummarySection.jsx` (new)

Extract stats + recent list from Dashboard. Props: `userId`.

#### `Settings.jsx`

Mount `ReceiptSummarySection` under **Your receipts**.

#### `Dashboard.jsx`

Remove stats fetch and receipt UI (CTA block may remain until 07.3).

---

### Phase 07.3 — Dinner default; Dashboard gone

#### Routing (`App.jsx`, `Auth.jsx`)

- Index `/` → `<Navigate to="/recipes" />`. Catch-all `*` → `/recipes`. Auth signed-in → `/recipes`.
- Remove Dashboard route. Delete `Dashboard.jsx`.

#### Tab bar / nav

- Dinner first tab. Remove Dashboard from `BottomTabBar.jsx`, `TopNavBar.jsx`. Logo → `/recipes`.

#### `Recipes.jsx`

- Mount slim `NeedsAttentionSection` at top (`variant="slim"`).

#### `NeedsAttentionSection.jsx`

- Optional `variant="slim"`: compact padding, smaller heading.

---

## Logic Guardrails

- Do not add `unlockDinner()` or half-complete metadata.
- Do not `navigate('/recipes')` after `complete()` — OnboardingRoute ejects.
- Do not mount Recipes on both `/` and `/recipes`.
- `complete()` retryable after `updateUser` failure.
- Joiner payoff copy must not claim pantry baseline.
- No `err.message` in Needs attention banner.

---

## Test-First Suite

### 07.1

**`OnboardingContext.test.jsx`**

- `COMPLETE_UPDATEUSER_FAILURE_ALLOWS_RETRY`
- `PAYOFF_DOUBLE_TAP_COMPLETES_ONCE`

**`StaplesTemplate.e2e.test.jsx`**

- `CONFIRM_DOES_NOT_WRITE_ONBOARDING_COMPLETED_AT`
- `CONFIRM_WARMS_SUGGESTION_POOL`
- `PAYOFF_TAP_WRITES_COMPLETED_AND_NAVIGATES_RECIPES`
- Skip shows payoff (not auto-home)
- Back+Save completes without payoff and ejects to recipes

**`OnboardingPayoffPanel.test.jsx`**

- `JOINER_PAYOFF_SKIPS_BASELINE_COPY`

**`DietaryRestrictions.test.jsx`**

- `JOINER_FINISH_SHOWS_PAYOFF_THEN_COMPLETE_JOIN_ON_TAP`

### 07.2

**`ReceiptSummarySection.test.jsx`** or **`Settings.test.jsx`**

- Summary values from `getReceiptSummary`
- Dashboard does not call `getReceiptSummary`

### 07.3

**`App.test.jsx`** / **`features.test.jsx`**

- `INDEX_AND_AUTH_REDIRECT_TO_RECIPES`
- `DASHBOARD_ROUTE_GONE`
- `TAB_BAR_HAS_NO_DASHBOARD_DINNER_IS_FIRST`
- `RECIPES_SHOWS_SLIM_ATTENTION_WHEN_STORE_SET`

---

## Definition of Done

### 07.1

- [x] Staples confirm does not write `onboarding_completed_at`
- [x] Payoff tap writes completion; user lands on `/recipes` via OnboardingRoute
- [x] `complete()` retryable on failure
- [x] Joiner payoff without baseline copy
- [x] Named 07.1 tests pass

### 07.2

- [x] Receipt stats in Settings
- [x] Dashboard does not fetch summary (`Dashboard.jsx` deleted in 07.3)
- [x] Named 07.2 tests pass

### 07.3

- [x] No Dashboard tab/route
- [x] `/` and Auth → `/recipes`
- [x] Slim attention on Recipes
- [x] Named 07.3 tests pass
