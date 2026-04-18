# T3-07 — `frontend/src/components/MealPlanWizard.jsx`

> **Tier:** 3 — Frontend
> **Why risky:** Largest single component in the codebase (~25 KB). Orchestrates multi-step meal-plan UI against the backend wizard API (`start / suggestions / accept / soft-reject / ban / leftover / complete`). Has no test file today. Bugs here are user-visible and data-corrupting (wrong recipes accepted into the real meal plan).

---

## 1. Technical Contract

- **File:** `frontend/src/components/MealPlanWizard.jsx`
- **Props (read file for exact list):** expected to receive `userId`, `householdId`, `startDate`, `mealSlots`, and close/complete callbacks.
- **External deps:** `api.mealPlan.*` from `apiClient`, `useAuth`, possibly `useHousehold` context.
- **Internal state:** current step, current meal type, candidate list, accepted list, banned list.

---

## 2. Logic Guardrails

- **Session start once:** `startWizard` fires exactly one POST on mount; StrictMode double-mount must not double-insert.
- **Soft-reject vs Ban:** soft-reject removes from current candidates only. Ban writes via `api.mealPlan.banRecipe` and persists across sessions. Visual affordances must be distinct.
- **Accept path:** must scale to household member count on the backend (wizard API handles it) — UI must pass `servings` explicitly.
- **Complete path:** only `completeWizard` commits to real meal plan. Closing the modal without completing MUST NOT persist.
- **Error surfacing:** any 4xx/5xx from wizard endpoints must render a user-facing error, never silently leave the UI in "loading" forever.
- **Threshold parameter:** `getSuggestions` is called with a `threshold` that lowers on "no suggestions". Pin the exact sequence (e.g. 0.9 → 0.7).
- **No duplicate accepts:** once a recipe id is accepted, pressing Accept again must be a no-op.

---

## 3. Test-First Suite

Create `frontend/src/tests/MealPlanWizard.test.jsx` (new). Mock `api.mealPlan.*` via `vi.mock('../services/apiClient', ...)`.

### Test group A — mount / session

1. `test_startWizard_called_exactly_once_on_mount`
2. `test_startWizard_not_called_when_mealSlots_all_false` (guard)

### Test group B — suggestion loop

3. `test_getSuggestions_called_with_initial_threshold_0_9`
4. `test_getSuggestions_threshold_lowers_when_empty_result`

### Test group C — accept / reject / ban

5. `test_accept_calls_acceptRecipe_and_advances_to_next_meal_slot`
6. `test_soft_reject_removes_recipe_from_local_candidates_only`
7. `test_ban_calls_banRecipe_and_removes_from_candidates`
8. `test_accept_twice_on_same_recipe_is_noop`

### Test group D — complete / close

9. `test_complete_calls_completeWizard_and_invokes_onComplete_prop`
10. `test_closing_without_complete_does_not_call_completeWizard`

### Test group E — error UX

11. `test_500_from_getSuggestions_surfaces_retry_ui`
12. `test_acceptRecipe_failure_does_not_advance_step`

---

## 4. Definition of Done

- ≥ 10 test cases covering all 5 groups.
- Start-once test (1) guards StrictMode double-mount.
- Ban/soft-reject distinction (6–7) is explicit.
- `completeWizard` is the ONLY path that commits (tests 9–10).
- Every backend endpoint used by the component has at least one mock assertion.
- No real network calls.
