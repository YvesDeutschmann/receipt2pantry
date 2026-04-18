# T1-03 — `backend/services/pantry_service.py`

> **Tier:** 1 — Critical
> **Why risky:** 20 methods, ~28 KB. Backs every pantry route. Current test file (`tests/services/test_pantry_service.py`) is ~7 KB — coverage gap. Handles household-vs-user scope fallback, quantity math, and the critical `add_to_pantry` dedupe path.

---

## 1. Technical Contract

- **File:** `backend/services/pantry_service.py`
- **Class:** `PantryService(supabase: SupabaseService)`
- **Async methods:** `add_to_pantry`, plus any that perform multi-row updates.
- **Sync methods:** `_get_pantry_items`, `_get_household_id_for_user`, and readers.
- **Scope rule:** prefer `household_id` when provided; fall back to user-scoped pantry only for legacy single-user accounts.

### Methods to characterize (priority order)

1. `add_to_pantry(user_id, normalized_item, quantity, unit, receipt_id, household_id=None)`
2. `_get_pantry_items(user_id, household_id)`
3. `_get_household_id_for_user(user_id)`
4. `update_quantity(item_id, quantity)`
5. `soft_delete(item_id, today=...)`
6. `restore(depletion_history_id)`
7. `confirm_staples(user_id, selected_items)`
8. `search_ingredients(query, exclude, limit)`

---

## 2. Logic Guardrails

- **Quantity arithmetic:** `add_to_pantry` must merge into an existing row when `(household_id, base_ingredient, variant, unit)` all match exactly. Any mismatch → new row. Never merge across different units.
- **`is not None` vs truthy:** `quantity=0` is a valid input to `update_quantity`; it should write `0`, not be treated as "missing".
- **Household preference:** `_get_pantry_items` must use household scope if `household_id` is truthy, regardless of whether the user also has legacy user-scoped rows.
- **Time-determinism:** every method that stamps `deleted_at`, `purchased_at`, or similar MUST accept `today` / `reference_date` and default to `date.today()` only at the call boundary.
- **No substring ingredient match:** all dedupe / merge decisions must compare `base_ingredient` via exact equality (normalized lowercase trim), never `in` or `ilike`.
- **Exception contract:** invalid input raises `ValidationException`; DB failure raises `DatabaseException`. Never let Supabase's raw error bubble up.

---

## 3. Test-First Suite

Expand `tests/services/test_pantry_service.py`.

### Test group A — add_to_pantry merge semantics

1. `test_add_to_pantry_merges_into_existing_row_on_exact_match` (same base_ingredient + variant + unit → quantity sums)
2. `test_add_to_pantry_creates_new_row_on_unit_mismatch` (g vs lb → new row, not conversion)
3. `test_add_to_pantry_creates_new_row_on_variant_mismatch` (salted vs unsalted butter)
4. `test_add_to_pantry_never_merges_by_substring` (adding "rice" must not merge into existing "rice vinegar")

### Test group B — scope resolution

5. `test_get_pantry_items_uses_household_scope_when_household_id_present`
6. `test_get_pantry_items_falls_back_to_user_scope_when_household_id_none`
7. `test_get_household_id_returns_none_when_user_has_no_household`

### Test group C — quantity updates

8. `test_update_quantity_accepts_zero_and_persists_zero`
9. `test_update_quantity_rejects_negative_with_validation_exception`

### Test group D — soft-delete / restore

10. `test_soft_delete_uses_provided_today_for_deleted_at_stamp`
11. `test_restore_reinserts_row_with_original_unit_and_variant`

### Test group E — staples

12. `test_confirm_staples_batches_all_selected_items_in_single_call`
13. `test_confirm_staples_is_idempotent_when_called_twice_with_same_list`

---

## 4. Definition of Done

- ≥ 12 test cases covering the 8 priority methods.
- At least one test in each group explicitly passes `today=date(2026, 1, 15)` to prove time-determinism.
- Regression test for `quantity=0` update is in place.
- Regression test for the substring-merge anti-pattern is in place.
- Tests run against the stubbed Supabase builder (no network).
