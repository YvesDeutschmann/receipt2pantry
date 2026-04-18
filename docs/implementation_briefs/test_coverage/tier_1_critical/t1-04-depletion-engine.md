# T1-04 — `backend/services/depletion_engine.py`

> **Tier:** 1 — Critical
> **Why risky:** Small file, outsized blast radius. Consumed by `pool_generator` AND meal-plan wizard accept flow. Contains an **active violation** of `.cursorrules.md`: substring matching on ingredient names. Must be tested and fixed as a pair.

---

## 1. Technical Contract

- **File:** `backend/services/depletion_engine.py`
- **Class:** `DepletionEngine(pantry_service: PantryService)`
- **Public methods:**
  - `snapshot_pantry(user_id, household_id) -> Dict[str, Dict]`
  - `available_ingredient_names(simulated_pantry) -> List[str]`
  - `deplete_from_extended_ingredients(simulated_pantry, extended_ingredients) -> Dict[str, Dict]`
- **Factory:** `create_depletion_engine(pantry_service)`.
- **Input shape:** `simulated_pantry` is keyed by `str(item_id)`; each value has `id, name, base_ingredient, quantity (float), unit, variant`.

---

## 2. Logic Guardrails

- **🔴 Substring match is a bug.** Lines ~63–64 use:
  ```python
  if base_ingredient in ing_name or ing_name in base_ingredient:
  ```
  This violates `.cursorrules.md` ("never use `in` / substring matching"). Expected behavior: exact equality on normalized `base_ingredient`. The test suite MUST prove the bug, then the fix lands.
- **Unit mismatch must skip** — no implicit conversion.
- **Non-destructive snapshot:** `snapshot_pantry` returns a dict; `deplete_from_extended_ingredients` must `deepcopy` before mutating.
- **Zero-quantity cleanup:** when depletion brings a row to exactly `0`, it must be removed from the returned dict (callers rely on this).
- **`break` after first match:** intentional — a recipe ingredient consumes one pantry row, not many. Document this in the test.
- **Quantity math:** `max(0.0, quantity - ing_amount)` — over-depletion is clamped to 0, never negative.

---

## 3. Test-First Suite

Expand `tests/services/test_depletion_engine.py`.

### Test group A — snapshot

1. `test_snapshot_excludes_items_with_zero_quantity`
2. `test_snapshot_is_independent_of_source_pantry_rows` (mutating snapshot must not mutate caller)

### Test group B — available ingredients

3. `test_available_ingredient_names_returns_sorted_unique_lowercase`
4. `test_available_ingredient_names_filters_zero_quantity`

### Test group C — depletion matching (regression-first)

5. `test_depletion_matches_on_exact_base_ingredient_only` (e.g. "rice" recipe vs pantry `{rice vinegar, rice}` → consumes `rice`, not `rice vinegar`)
6. `test_depletion_does_not_match_egg_against_eggplant`
7. `test_depletion_does_not_match_oil_against_olive_oil`
8. `test_depletion_skips_when_unit_differs` (lb vs g: no depletion)
9. `test_depletion_clamps_at_zero_when_recipe_exceeds_pantry_quantity`
10. `test_depletion_removes_row_when_quantity_reaches_zero`
11. `test_depletion_consumes_only_one_row_per_ingredient` (verify the `break` contract)
12. `test_depletion_returns_new_dict_original_unchanged`

### Test group D — time-determinism guard

13. No time dependencies expected — assert the module imports no `datetime.today()` / `datetime.now()` calls (AST scan or simple import check).

---

## 4. Definition of Done

- Tests 5–7 run and FAIL against current code (proving the substring-match bug).
- After fixing `depletion_engine.py` to use exact base-ingredient equality, all tests pass.
- Test file documents the "one pantry row per recipe ingredient" contract in a docstring.
- The fix preserves the `deepcopy` + zero-removal behavior (tests 2 and 10 verify this).
- Follow-up brief T1-05 (pool_generator) depends on this fix — do not close this brief before that test suite can import the corrected engine.
