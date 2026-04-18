# T3-05 — `frontend/src/contexts/OnboardingContext.jsx`

> **Tier:** 3 — Frontend
> **Why risky:** Drives the cold-start arc (staples template, first receipt sync, first pantry population). Coordinates with `AuthContext` and receipt-fetch hooks. No dedicated test file today.

---

## 1. Technical Contract

- **File:** `frontend/src/contexts/OnboardingContext.jsx`
- **Exports:** `OnboardingProvider`, `useOnboarding`.
- **Context value (read current file for exact shape):** onboarding step flags, current step, advance/reset actions, and any `templateConfirmed` / `syncStarted` flags.
- **Dependencies:** `AuthContext` (for `onboardingComplete`), `apiClient` for persistence.

---

## 2. Logic Guardrails

- **Step progression is monotonic:** advancing to step N implies all steps < N are complete. Tests must prevent "skip-ahead" bugs that flip a later step true without completing earlier ones.
- **Persistence boundary:** final completion flag is persisted via `supabase.auth.updateUser({ data: { onboarding_completed_at: <ISO> }})` (or equivalent). Must be invoked exactly once.
- **Re-entry safety:** if the user returns to onboarding after a partial completion, resumed state reflects the last persisted step.
- **Auth dependency:** onboarding actions must not fire before `AuthContext.loading === false`.
- **Route coupling:** `OnboardingRoute` consumer must NOT re-render in a loop when flags change (memoize the context value).

---

## 3. Test-First Suite

Create `frontend/src/tests/OnboardingContext.test.jsx` (new).

### Test group A — hook enforcement

1. `test_useOnboarding_throws_outside_provider`

### Test group B — step progression

2. `test_advancing_step_marks_all_prior_steps_complete`
3. `test_cannot_mark_later_step_complete_without_earlier_steps`
4. `test_reset_returns_all_steps_to_initial_state`

### Test group C — persistence

5. `test_complete_calls_updateUser_with_onboarding_completed_at_iso_timestamp`
6. `test_complete_invoked_only_once_even_when_action_fired_twice`

### Test group D — auth dependency

7. `test_actions_noop_while_auth_loading_true`

### Test group E — stability

8. `test_context_value_is_stable_reference_when_unrelated_state_changes` (prevents render storms)

---

## 4. Definition of Done

- Step monotonicity (tests 2–3) is enforced.
- `onboarding_completed_at` written at most once (test 6).
- No action fires while auth is loading (test 7).
- Context value reference stability is verified (test 8).
- Tests mock Supabase and `apiClient`.
