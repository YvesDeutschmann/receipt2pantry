# T2-02 — `backend/services/meal_plan_service.py`

> **Tier:** 2 — High
> **Why risky:** ~41 KB, 15 async methods, no dedicated test file in `tests/services/`. Uses `datetime.utcnow()` (deprecated + not tz-aware) and does NOT accept a `reference_date` parameter — a direct violation of `.cursorrules.md` Time-Determinism rule. Wizard session lifecycle (delete-then-insert) is non-atomic.

---

## 1. Technical Contract

- **File:** `backend/services/meal_plan_service.py`
- **Class:** `MealPlanService(supabase_service, pantry_service, recipe_service, household_service)`
- **Async entry points:**
  - `start_wizard(user_id, household_id, meal_slots, start_date)`
  - `get_suggestions(session_id, meal_type, threshold)`
  - `accept_recipe(session_id, ...)`
  - `soft_reject_recipe(session_id, recipe_id)`
  - `ban_recipe(session_id, recipe_id, recipe_name, user_id)`
  - `unban_recipe(session_id, recipe_id, user_id)`
  - `mark_leftover(session_id, ...)`
  - `complete_wizard(session_id)`
  - `suggest_staple_meals(session_pantry, meal_type)`

---

## 2. Logic Guardrails

- **🔴 Time-Determinism violation:** every method that reads "now" must accept `now: datetime | None = None`, defaulting at the call boundary. Before writing behavioral tests, do this refactor.
- **Wizard session uniqueness:** at most one active session per `household_id`. `start_wizard` currently deletes then inserts — tests must lock the happy path AND document the non-atomic window.
- **Meal slots:** `meal_slots` is a dict with `breakfast/lunch/dinner` booleans; at least one must be `True`. Missing all three → `ValidationException`.
- **Session pantry clone:** `session_pantry` must be an independent copy of the real pantry at `start_wizard` time. Mutations in the wizard must never leak back into pantry until `complete_wizard`.
- **Household member scaling:** all accepted recipes must be scaled to `len(household_members)` when `orig_servings != member_count`.
- **Accept / soft-reject / ban semantics:**
  - Accept: mutate `session_pantry`, append to `session.accepted_recipes`.
  - Soft-reject: only affects `session.swiped_recipe_ids`; does NOT write to `recipe_bans`.
  - Ban: writes to `recipe_bans` with an `expires_at`. Must be reversible via `unban`.
- **Complete wizard:** is the ONLY operation that promotes session state into real pantry/meal_plan rows. Failure mid-promotion must not leave partial rows.

---

## 3. Test-First Suite

Create `tests/services/test_meal_plan_service.py` (new file).

### Test group A — session lifecycle

1. `test_start_wizard_creates_fresh_session_when_none_active`
2. `test_start_wizard_replaces_existing_session_for_same_household`
3. `test_start_wizard_raises_validation_when_no_meal_slots_true`
4. `test_start_wizard_clones_pantry_independently` (mutating session_pantry does not affect source)

### Test group B — determinism prerequisite

5. `test_start_wizard_accepts_now_parameter` (proves refactor landed)
6. `test_expiry_check_uses_injected_now_not_utcnow`

### Test group C — accept / scale

7. `test_accept_recipe_scales_to_household_member_count`
8. `test_accept_recipe_mutates_session_pantry_but_not_real_pantry`
9. `test_accept_recipe_fails_when_session_pantry_insufficient`

### Test group D — soft-reject / ban

10. `test_soft_reject_adds_to_swiped_ids_only_no_ban_row`
11. `test_ban_writes_recipe_ban_row_with_expires_at`
12. `test_unban_deletes_recipe_ban_row`

### Test group E — staple fallback

13. `test_suggest_staple_meals_returns_breakfast_options_for_sparse_pantry`
14. `test_suggest_staple_meals_returns_empty_for_dinner`

### Test group F — complete

15. `test_complete_wizard_promotes_accepted_recipes_to_meal_plan`
16. `test_complete_wizard_rolls_back_on_promotion_failure` (documented known gap if non-atomic)

---

## 4. Definition of Done

- Refactor #1: inject `now` parameter into every time-dependent method. Tests 5–6 prove this.
- ≥ 14 test cases across 6 groups.
- Session-pantry isolation (tests 4 and 8) is verified with explicit object identity checks.
- Ban persistence (tests 11–12) is locked in.
- Test 16 is allowed to be `xfail`-marked if atomic promotion requires an RPC upgrade; note this in a follow-up brief.
