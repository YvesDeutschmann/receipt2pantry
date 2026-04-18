# T1-06 — `backend/services/pool_store_service.py`

> **Tier:** 1 — Critical
> **Why risky:** Persistence + mutex layer for suggestion pool. Contains a classic TOCTOU race in `start_generation`, non-atomic pool writes (`clear_unused` + `add_suggestions` are separate calls from the caller), and a wall-clock stale-timeout that's not injectable.

---

## 1. Technical Contract

- **File:** `backend/services/pool_store_service.py`
- **Class:** `PoolStoreService(supabase: SupabaseService)`
- **Constants:** `STALE_GENERATION_MINUTES = 10`.
- **Methods:**
  - `start_generation(household_id, user_id, trigger_reason, meal_types) -> {generation_id, already_running}`
  - `complete_generation(generation_id, status, suggestions_count, error_message=None)`
  - `clear_unused(household_id, meal_type=None)`
  - `get_swiped_recipe_ids(household_id) -> Set[str]`
  - `get_pool(household_id, meal_type=None, status="unused") -> List[Dict]`
  - `get_pool_grouped_by_meal(household_id, status="unused") -> Dict[str, List[Dict]]`
  - `get_pool_depth(household_id) -> Dict[str, int]`
  - `add_suggestions(household_id, user_id, generation_id, suggestions) -> int`
  - `update_status(suggestion_id, household_id, new_status) -> bool`
  - `get_suggestion(suggestion_id, household_id) -> Optional[Dict]`

---

## 2. Logic Guardrails

- **Stale cleanup:** `_fail_stale_in_progress` must flip `status="failed"` on rows older than 10 minutes. Cutoff must be injectable — current impl uses `datetime.now(timezone.utc)` directly (Time-Determinism violation, fix before testing time-dependent logic deterministically).
- **TOCTOU race:** `start_generation` performs `select active → insert`. Two concurrent calls can both see no active row. Pin current behavior with a test, then plan an RPC upgrade.
- **Empty meal_types:** must raise `DatabaseException("meal_types must include at least one meal type")`.
- **`clear_unused` scope:** deletes `status="unused"` only; optional `meal_type` filter further narrows. Must not touch `swiped` rows.
- **`add_suggestions` dedupe:** must skip `recipe_id`s that are already swiped, and must skip `recipe_id`s already present for the household (regardless of status).
- **Return value of `add_suggestions`:** count of rows actually inserted (not count of input list).
- **`update_status`:** must filter by BOTH `suggestion_id` and `household_id` to prevent cross-household updates.
- **Default grouping buckets:** `get_pool_grouped_by_meal` must always return all three keys (`breakfast`, `lunch`, `dinner`), even when empty.

---

## 3. Test-First Suite

Expand `tests/services/test_pool_store_service.py`.

### Test group A — start_generation semantics

1. `test_start_generation_raises_on_empty_meal_types`
2. `test_start_generation_returns_already_running_when_active_row_exists`
3. `test_start_generation_inserts_new_row_when_no_active`
4. `test_fail_stale_in_progress_flips_rows_older_than_ten_minutes` (needs injectable `now`)
5. `test_fail_stale_in_progress_leaves_recent_rows_alone`

### Test group B — clear / dedupe

6. `test_clear_unused_only_deletes_status_unused_rows`
7. `test_clear_unused_meal_type_filter_narrows_delete`
8. `test_add_suggestions_skips_swiped_recipe_ids`
9. `test_add_suggestions_skips_already_present_recipe_ids`
10. `test_add_suggestions_returns_count_of_actually_inserted`

### Test group C — read shape

11. `test_get_pool_grouped_returns_all_three_meal_keys_even_when_empty`
12. `test_get_pool_depth_returns_zero_for_meals_with_no_unused_rows`
13. `test_get_swiped_recipe_ids_returns_set_of_strings`

### Test group D — update & read auth

14. `test_update_status_filters_by_household_id` (prevents cross-household mutation)
15. `test_get_suggestion_returns_none_when_suggestion_belongs_to_other_household`

### Test group E — race-documenting test

16. `test_start_generation_is_not_atomic_against_concurrent_caller` — document current behavior (passes) with a `# TODO: convert to RPC for true atomicity` marker.

---

## 4. Definition of Done

- All 5 test groups implemented, ≥ 15 cases.
- Test 4 fixed by extracting `_fail_stale_in_progress(household_id, now=None)` signature (minor impl change) — this is an acceptable fix within this brief.
- Test 16 is explicitly marked as documenting a known race; a follow-up ticket/brief references it.
- No test touches a real Supabase client; all use the T1-01 builder stub.
