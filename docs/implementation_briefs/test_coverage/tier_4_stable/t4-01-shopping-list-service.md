# T4-01 — `backend/services/shopping_list_service.py`

> **Tier:** 4 — Stable
> **Why worth testing:** Small surface, but the "meal plan → shopping list" diff is the moment where pantry errors become visible to the user (wrong items show up in the list). Currently no dedicated unit test file.

---

## 1. Technical Contract

- **File:** `backend/services/shopping_list_service.py`
- **Class:** `ShoppingListService(supabase: SupabaseService)`
- **Methods (entry points):**
  - `generate_from_meal_plan(household_id, start_date, end_date) -> Dict` (async)
  - + readers / mark-purchased mutators.
- **Returns:** shopping list summary with grouped items and count.

---

## 2. Logic Guardrails

- **Diff math:** required ingredients from meal plan minus current pantry quantities → shopping list items. Over-sufficient pantry → item excluded.
- **Unit awareness:** diff must never subtract across mismatched units.
- **Date window:** `start_date <= end_date`; reversed range raises `ValidationException`.
- **Household scoping:** all queries filter by `household_id`; no user-scope fallback.
- **Empty meal plan:** returns `{ items: [], count: 0 }`, does not raise.
- **Idempotency:** re-generating for the same window with no pantry changes yields the same list.

---

## 3. Test-First Suite

Create `tests/services/test_shopping_list_service.py`.

### Test group A — diff math

1. `test_item_fully_in_pantry_is_excluded`
2. `test_item_partially_in_pantry_is_included_with_reduced_quantity`
3. `test_item_not_in_pantry_is_included_at_full_quantity`

### Test group B — unit awareness

4. `test_diff_does_not_subtract_across_mismatched_units`

### Test group C — validation

5. `test_reversed_date_range_raises_validation_exception`
6. `test_empty_meal_plan_returns_empty_list_without_raising`

### Test group D — idempotency

7. `test_regeneration_yields_identical_list_with_unchanged_inputs`

### Test group E — scoping

8. `test_queries_filter_by_household_id_only`

---

## 4. Definition of Done

- ≥ 7 test cases.
- Unit-mismatch test (4) is in place.
- Household-only scope (test 8) pins the rule.
- No real Supabase — use the T1-01 builder stub.
