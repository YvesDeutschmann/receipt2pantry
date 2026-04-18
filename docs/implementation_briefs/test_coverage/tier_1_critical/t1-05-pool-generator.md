# T1-05 — `backend/services/pool_generator.py`

> **Tier:** 1 — Critical
> **Why risky:** New Phase 4 code. Nested 7-day × 3-meal loop, manual mutex, threshold-walk logic (0.9 → 0.7), staple fallback, ban/swipe filters, and a sync-in-async event-loop hack. High complexity, thin existing coverage.

---

## 1. Technical Contract

- **File:** `backend/services/pool_generator.py`
- **Class:** `PoolGenerator(pool_store, depletion, recipe_service, meal_plan_service)`
- **Entry point:** `generate_pool(household_id, user_id, trigger_reason, meal_types) -> {generation_id, status, suggestions_generated, error}`
- **Helpers:** `_load_banned_ids`, `_filter_recipes`, `_recipes_for_step`.
- **Constants:** `ORDERED_MEALS = ("breakfast", "lunch", "dinner")`, `INGREDIENT_SPARSE_THRESHOLD = 3`.

---

## 2. Logic Guardrails

- **Mutex honored:** if `pool_store.start_generation` returns `already_running=True`, `generate_pool` must short-circuit with `status="already_running"` and **not** clear the pool.
- **No clear-on-failure:** `clear_unused` must fire ONLY when `final_status == "completed"` (SUG-015/016).
- **Threshold walk:** match threshold starts at 0.9 and steps down to 0.7 (inclusive) in 0.1 increments. Stops at first non-empty candidate set.
- **Staple fallback rules:**
  - Triggered when `len(available_ingredients) < INGREDIENT_SPARSE_THRESHOLD` AND meal is breakfast/lunch.
  - Also triggered when threshold walk yields zero candidates AND meal is breakfast/lunch.
  - Dinner never gets staple fallback.
- **Ban + swipe + run-dedup:** a recipe id must be filtered if it's in `banned`, `swiped`, or already in `run_ids` for this run.
- **Staple recipes** (`is_staple=True` or id startswith `"staple_"`): skip threshold gate, default `match_percentage=1.0`.
- **Depletion step:** uses top candidate's details, scales servings to household member count, deducts from `simulated` pantry. Exceptions must be warned and swallowed (don't abort the run).
- **AIServiceException:** propagates up to mark run `status="partial"` and stops further steps.
- **🔴 Event-loop hack:** `asyncio.get_event_loop()` + `run_until_complete` is deprecated on Python 3.11+. Tests should pin the current behavior so a refactor (e.g. to `asyncio.run`) does not regress.
- **🔴 File side-effect:** `_agent_dbg` writes to `debug-ef2920.log` in repo root — violates "Functional Core". Tests must run cleanly without creating this file (patch it out).

---

## 3. Test-First Suite

Expand `tests/services/test_pool_generator.py`.

### Test group A — mutex

1. `test_generate_pool_short_circuits_when_already_running`
2. `test_generate_pool_calls_start_generation_before_any_db_reads`

### Test group B — status transitions

3. `test_generate_pool_calls_complete_generation_with_completed_on_happy_path`
4. `test_generate_pool_marks_partial_on_ai_service_exception_mid_run`
5. `test_generate_pool_marks_failed_on_unexpected_exception`
6. `test_clear_unused_not_called_when_status_partial` (preserves existing pool)
7. `test_clear_unused_not_called_when_status_failed`

### Test group C — threshold walk & staples

8. `test_threshold_walks_from_point_nine_to_point_seven`
9. `test_threshold_walk_stops_at_first_non_empty_set`
10. `test_sparse_pantry_triggers_staple_fallback_for_breakfast_and_lunch_only`
11. `test_dinner_never_uses_staple_fallback`
12. `test_staple_recipe_bypasses_threshold_gate`

### Test group D — filter semantics

13. `test_filter_excludes_banned_recipe_ids`
14. `test_filter_excludes_swiped_recipe_ids`
15. `test_filter_excludes_recipes_already_added_in_run`

### Test group E — depletion between steps

16. `test_top_candidate_depletes_simulated_pantry_before_next_step`
17. `test_depletion_failure_is_warned_and_run_continues` (exceptions in scale/deplete must not abort the loop)

### Test group F — side-effects hygiene

18. `test_agent_dbg_patched_does_not_write_debug_file` (patch `_agent_dbg` and assert file absent)

---

## 4. Definition of Done

- All 5 test groups present with ≥ 15 test cases total.
- Tests patch `_agent_dbg` so no debug file is written during CI.
- Tests do NOT use real `asyncio.get_event_loop()` — inject mock `meal_plan_service` whose `suggest_staple_meals` returns a ready list.
- SUG-015/016 (no clear-on-partial) is locked in by tests 6 and 7.
- Depends on T1-04 (depletion engine) being correct — if T1-04 tests still fail, this brief is blocked.
