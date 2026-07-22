# 02b — Sparse Pantry Resilience

> **Prerequisite:** Brief `02a-suggestion-cost-caching.md` must be complete. The pool-first path in `SuggestionService.get_recipe_suggestions()` must exist so that onboarding-triggered pool results can be served without Spoonacular calls on thin pantries.
>
> **Scope:** Two production service files (`backend/services/suggestion_service.py`, `backend/services/pool_generator.py`) and their tests. No routes, no frontend, no migration required.
>
> **Do NOT touch in this phase:** `backend/services/recipe_service.py` (already updated in 02a), `backend/services/pool_store_service.py`, `backend/routes/`, `frontend/`, `supabase/migrations/`. Do not change `INGREDIENT_SPARSE_THRESHOLD` (keep at 3); the changes below extend existing behaviour rather than alter the constant.

---

## Objective

A brand-new user who has confirmed their staples list but whose receipt sync is still running must receive at least one credible "What's for Dinner" suggestion instead of a blank screen. Achieve this by (a) relaxing the confidence threshold in `SuggestionService` as a function of pantry size, (b) adding a confidence-agnostic last-resort ingredient fallback, (c) surfacing a `missed_count` field on each recipe card so the frontend can show "you'll need to buy N items", (d) extending the pool generator's sparse-pantry staple fallback to the dinner slot, and (e) including a `meta` envelope in the SuggestionResult so the frontend can show contextual "add more items" guidance. The invariant is: **no user with ≥ 1 pantry item ever receives an all-empty SuggestionResult**.

---

## Technical Contract

### 1. `backend/services/suggestion_service.py` (modified — extends 02a)

#### 1a. New module-level pure function: `_confidence_threshold_for_pantry_size`

```python
def _confidence_threshold_for_pantry_size(pantry_item_count: int) -> float:
    """
    Return the minimum confidence required to include a pantry item in the
    ingredient list sent to Spoonacular.

    Breakpoints (chosen to match onboarding staples flow):
      0–2 items  → 0.0  (any item used, even freshly added staples)
      3–9 items  → 0.20 (check_first tier and above)
      ≥ 10 items → 0.50 (probably_have tier and above — normal operation)
    """
    if pantry_item_count < 3:
        return 0.0
    if pantry_item_count < 10:
        return 0.20
    return 0.50
```

This function is pure (no I/O, no state). Accept it with a single `int` argument; do not add optional parameters.

#### 1b. Fallback ladder in `get_recipe_suggestions`

Replace the hard-coded `c >= 0.50` filter in the `high_conf_names` loop with the adaptive threshold. The modified section (replacing the existing loop around line 248) must follow this logic:

```
threshold = _confidence_threshold_for_pantry_size(len(pantry))
fallback_mode = threshold < 0.50    # True when pantry is thin

high_conf_names = [
    base
    for p in pantry
    for base in [(p.get("base_ingredient") or "").strip().lower()]
    if base
    if confidences_by_id.get(str(p.get("id") or ""), 0.0) >= threshold
]
```

After building `ingredient_list = sorted(set(high_conf_names + use_soon_names))`:

**Last-resort step:** if `ingredient_list` is empty AND `len(pantry) > 0`:
```
# All pantry items, confidence-agnostic, as a last resort
ingredient_list = sorted({
    (p.get("base_ingredient") or "").strip().lower()
    for p in pantry
    if (p.get("base_ingredient") or "").strip()
})
fallback_mode = True
```

If `ingredient_list` is still empty after the last-resort step (meaning `len(pantry) == 0` or all `base_ingredient` fields are blank):
```
return {
    "use_soon_shelf": [], "cook_tonight": [],
    "probably_have": [], "check_first": [],
    "meta": {
        "fallback_mode": False,
        "pantry_item_count": len(pantry),
        "threshold_used": threshold,
    },
}
```
Do NOT call Spoonacular with an empty ingredient list.

`fallback_mode` and `threshold` must be computed before any early returns so they can be included in the `meta` envelope.

#### 1c. `meta` envelope in the returned SuggestionResult

Append to every code path that returns a SuggestionResult dict (normal, pool-first from 02a, last-resort empty):

```python
"meta": {
    "fallback_mode": bool(fallback_mode),
    "pantry_item_count": len(pantry),
    "threshold_used": float(threshold),
}
```

For the **pool-first fast path** introduced in 02a (which returns before pantry is loaded), add a lightweight pantry-size read after the pool depth check:

```python
if self.pool_store is not None:
    depth = self.pool_store.get_pool_depth(household_id)
    if sum(depth.values()) > 0:
        grouped = self.pool_store.get_pool_grouped_by_meal(household_id, status="unused")
        result = _pool_grouped_to_suggestion_result(grouped)
        # Minimal pantry size for meta (load only count, not full items)
        pantry_count = len(self.pantry_service._get_pantry_items(user_id, household_id))
        pool_threshold = _confidence_threshold_for_pantry_size(pantry_count)
        result["meta"] = {
            "fallback_mode": pool_threshold < 0.50,
            "pantry_item_count": pantry_count,
            "threshold_used": float(pool_threshold),
        }
        return result
```

#### 1d. `missed_count` in `score_recipe` output

Append one field to the returned recipe card dict in `score_recipe()`:

```python
"missed_count": len([
    f for f in ingredient_flags
    if f["confidence"] == 0.0 and not f["is_soft_required"]
])
```

Rules:
- Use `f["confidence"] == 0.0` (exact float comparison) to identify missing primary ingredients. Do not use `< some_threshold`; zero means no pantry match was found.
- `f["is_soft_required"]` must use `is not None` safe access via `.get("is_soft_required", False)` to avoid KeyError on unexpected card shapes.
- If `ingredient_flags` is empty, `missed_count` is 0.
- This field is present on every non-suppressed recipe card, including those returned through the normal scoring path. It is NOT added to the pool-first path cards (those have `"ingredient_flags": []`); consumers must treat `missed_count` as optional.

**What `missed_count` means to the consumer:** the number of primary ingredients in the recipe that the user does not have at all (confidence == 0.0). The frontend should render "you'll need to buy N items" when `missed_count > 0` and `tier == "check_first"` or `tier == "probably_have"`.

#### 1e. Never-empty invariant enforcement (last resort — Spoonacular returned nothing)

After the candidate loop and scoring, if all four tier lists are empty AND `len(pantry) > 0`:

```python
if all(len(results[k]) == 0 for k in results) and len(pantry) > 0:
    logger.warning(json.dumps({
        "event": "sparse_pantry_no_results",
        "pantry_item_count": len(pantry),
        "ingredient_count": len(ingredient_list),
        "fallback_mode": fallback_mode,
    }))
    if self.pool_store is not None:
        # Try swiped pool entries as last resort (user has already seen them but
        # they are better than an empty screen).
        swiped_grouped = self.pool_store.get_pool_grouped_by_meal(
            household_id, status="swiped"
        )
        if any(swiped_grouped.values()):
            result = _pool_grouped_to_suggestion_result(swiped_grouped)
            result["meta"] = {
                "fallback_mode": True,
                "pantry_item_count": len(pantry),
                "threshold_used": float(threshold),
            }
            return result
```

If even swiped pool is empty, return the all-empty SuggestionResult with `meta.fallback_mode=True`. The calling route can surface an "Add more items" prompt using `meta.fallback_mode`.

---

### 2. `backend/services/pool_generator.py` (modified)

#### 2a. Extend sparse-pantry staple fallback to the dinner slot

There are exactly two locations in `_recipes_for_step()` that restrict the staple-meal fallback to breakfast and lunch. Change both.

**Location 1** — threshold guard at the start of the method (current code):
```python
if len(av) < INGREDIENT_SPARSE_THRESHOLD and meal_type in ("breakfast", "lunch"):
```
Change to:
```python
if len(av) < INGREDIENT_SPARSE_THRESHOLD and meal_type in ("breakfast", "lunch", "dinner"):
```

**Location 2** — fallback after threshold stepping loop (current code):
```python
if not candidates and meal_type in ("breakfast", "lunch"):
```
Change to:
```python
if not candidates and meal_type in ("breakfast", "lunch", "dinner"):
```

No other changes to `pool_generator.py`. Do not rename `INGREDIENT_SPARSE_THRESHOLD`; do not change its value.

**Interaction with `trigger_reason="onboarding"`:** when the pool is generated during onboarding (thin pantry, few or no receipts synced), these two changes ensure all three meal slots receive staple-meal suggestions instead of returning empty. The `pool_store.add_suggestions` and `clear_unused` flow is unchanged; onboarding suggestions are stored as normal pool rows and served by the pool-first path added in 02a.

---

## Logic Guardrails

- `_confidence_threshold_for_pantry_size` must use `<` comparisons only (not `<=`); breakpoints are at 3 and 10 items.
- The last-resort ingredient list (confidence-agnostic) must use exact `base_ingredient` values (lowercased, stripped), never substring matching. Do not use `in` or `LIKE` against ingredient names.
- `missed_count` uses `== 0.0` exact comparison for confidence, not `< 0.01` or similar tolerance. Confidence values below 0.0 are impossible by `compute_confidence` contract; guard with `is not None` nonetheless.
- The never-empty invariant applies when `len(pantry) > 0`. If the pantry is genuinely empty (0 items), returning all-empty tiers is correct — do not invent suggestions.
- `meta` must be present on every returned dict from `get_recipe_suggestions()` regardless of code path.
- `fallback_mode: False` when pantry has ≥ 10 items and normal threshold (0.50) is in effect, even if some tiers happen to be empty (e.g., all recipes require many missing ingredients).
- The swiped-pool last resort must use `status="swiped"` (not "unused") — do not change pool row status to "unused" as a side effect. Serve swiped items read-only.
- `pool_store.get_pool_grouped_by_meal(household_id, status="swiped")` is an existing method signature; verify it accepts the `status` kwarg (it does — see `PoolStoreService.get_pool` which takes `status` as a parameter).
- Dinner staple fallback in `pool_generator._recipes_for_step`: the `suggest_staple_meals` call is `async`; the existing `asyncio.get_event_loop / new_event_loop` pattern must be preserved unchanged for both locations.
- Date/time determinism: `get_recipe_suggestions` already accepts `today` and `now` parameters; no new time-dependent logic is introduced in 02b, so no additional parameter is needed.
- No PII (user IDs, ingredient names from the user's pantry) in the `sparse_pantry_no_results` log line — `pantry_item_count` and `ingredient_count` (counts only) are safe.

---

## Test-First Suite

All tests live in `backend/tests/test_sparse_pantry_resilience.py` and run with `pytest`. Mock `requests.get`, Supabase clients, and `PoolStoreService`. Do not make live network calls.

### `_confidence_threshold_for_pantry_size`

- `THRESHOLD_ZERO_ITEMS` — 0 items → `0.0`.
- `THRESHOLD_TWO_ITEMS` — 2 items → `0.0`.
- `THRESHOLD_THREE_ITEMS` — 3 items → `0.20`.
- `THRESHOLD_NINE_ITEMS` — 9 items → `0.20`.
- `THRESHOLD_TEN_ITEMS` — 10 items → `0.50`.
- `THRESHOLD_LARGE_PANTRY` — 50 items → `0.50`.

### Fallback ladder in `get_recipe_suggestions`

- `EMPTY_PANTRY_RETURNS_EMPTY_ALL_TIERS` — 0 pantry items → all four tier lists are empty; no `AIServiceException`; `meta.pantry_item_count == 0`.
- `EMPTY_PANTRY_DOES_NOT_CALL_SPOONACULAR` — 0 pantry items → `recipe_service.get_recipes_by_pantry` never called.
- `THREE_STAPLES_USES_RELAXED_THRESHOLD` — 3 pantry items each with confidence 0.25 (≥ 0.20 threshold for a 3-item pantry) → ingredient list is non-empty; `recipe_service.get_recipes_by_pantry` called; `meta.threshold_used == 0.20`.
- `SMALL_PANTRY_CONF_BELOW_NORMAL_BUT_ABOVE_RELAXED_INCLUDED` — 5 pantry items with confidence 0.30 each; threshold for 5 items is 0.20 → items included in ingredient list; `recipe_service.get_recipes_by_pantry` called.
- `LAST_RESORT_USES_ALL_PANTRY_WHEN_INGREDIENT_LIST_EMPTY` — 2 pantry items with confidence 0.0 each; threshold for 2 items is 0.0 → but `c >= 0.0` is always True... Actually `confidence = 0.0` and `threshold = 0.0`, so `0.0 >= 0.0 == True`, so items ARE included. Last resort is only triggered when no items pass even the 0.0 threshold. Let me reconsider.

The last-resort step is actually needed when ALL items have blank `base_ingredient` (not when confidence is low, since threshold drops to 0.0 for small pantries). Let me fix:

- `LAST_RESORT_TRIGGERED_WHEN_HIGH_CONF_FILTER_EMPTY` — 12 pantry items (threshold 0.50) with ALL having confidence 0.35 → normal filter produces empty list → last-resort adds all items by base_ingredient → ingredient list non-empty → Spoonacular called; `meta.fallback_mode == True`.
- `LAST_RESORT_NOT_TRIGGERED_WHEN_ITEMS_PASS_THRESHOLD` — 12 pantry items, 5 with confidence 0.60 → last resort NOT triggered; only the 5 high-conf items used.
- `NEVER_EMPTY_WITH_POOL_WHEN_SPOONACULAR_RETURNS_NOTHING` — pantry has 3 items; Spoonacular returns empty list; `pool_store` has unused items → result has non-empty tier; `meta.fallback_mode == True`.
- `NEVER_EMPTY_USES_SWIPED_POOL_AS_LAST_RESORT` — pantry has 3 items; Spoonacular returns no results; pool has 0 unused but 2 swiped → swiped items returned in result; `meta.fallback_mode == True`.
- `EMPTY_RESULT_ACCEPTABLE_WHEN_PANTRY_IS_EMPTY` — 0 pantry items, pool is empty → all-empty tiers returned, no exception.
- `META_ALWAYS_PRESENT` — assert `"meta"` key exists in returned dict for: (a) normal path, (b) pool-first path, (c) empty pantry path.
- `META_FALLBACK_FALSE_FOR_LARGE_PANTRY` — 10 pantry items with normal confidence → `meta.fallback_mode == False`, `meta.threshold_used == 0.50`.

### `score_recipe` — `missed_count`

- `MISSED_COUNT_ALL_PRESENT` — all `ingredient_flags` have confidence > 0.0 → `missed_count == 0`.
- `MISSED_COUNT_ONE_MISSING_PRIMARY` — one flag has `confidence == 0.0` and `is_soft_required == False` → `missed_count == 1`.
- `MISSED_COUNT_EXCLUDES_SOFT_REQUIRED_MISSING` — one flag has `confidence == 0.0` and `is_soft_required == True` → `missed_count == 0`.
- `MISSED_COUNT_PRESENT_ON_EVERY_TIER` — score recipes that land in cook_tonight, probably_have, and check_first; all three card dicts have a `missed_count` key.

### Pool generator sparse-dinner fallback

- `POOL_GENERATOR_DINNER_SPARSE_CALLS_STAPLE_MEALS` — `av` has 2 items (< `INGREDIENT_SPARSE_THRESHOLD=3`), `meal_type="dinner"` → `suggest_staple_meals` called; `get_recipes_by_pantry` NOT called.
- `POOL_GENERATOR_DINNER_NO_CANDIDATES_AFTER_THRESHOLD_STEP_CALLS_STAPLE_MEALS` — `av` has 5 items but Spoonacular returns 0 recipes after threshold-stepping to 0.7 → `suggest_staple_meals` called for `meal_type="dinner"`.
- `POOL_GENERATOR_LUNCH_SPARSE_STILL_CALLS_STAPLE_MEALS` — regression guard: `meal_type="lunch"` with `av` < threshold → `suggest_staple_meals` still called (existing behaviour preserved).
- `POOL_GENERATOR_BREAKFAST_SPARSE_STILL_CALLS_STAPLE_MEALS` — regression guard: `meal_type="breakfast"` with `av` < threshold → `suggest_staple_meals` still called.

---

## Definition of Done

- [ ] `_confidence_threshold_for_pantry_size` exists as a module-level pure function in `suggestion_service.py`; all six threshold boundary tests pass.
- [ ] The confidence filter in `get_recipe_suggestions` uses `_confidence_threshold_for_pantry_size(len(pantry))` instead of the hard-coded `0.50`.
- [ ] Last-resort ingredient list is populated from all non-blank `base_ingredient` values when the adaptive filter produces an empty list and `len(pantry) > 0`; `fallback_mode` is set to `True`.
- [ ] `get_recipe_suggestions` never calls `get_recipes_by_pantry` with an empty `ingredient_list`.
- [ ] Every returned SuggestionResult dict includes a `"meta"` key with `fallback_mode`, `pantry_item_count`, and `threshold_used`.
- [ ] `score_recipe` returns a `missed_count` field on every non-suppressed card; value is `>= 0`; soft-required missing ingredients are excluded.
- [ ] Pool-first fast path (from 02a) also includes `meta` envelope with correct `fallback_mode` and `pantry_item_count`.
- [ ] Swiped-pool last-resort path: when Spoonacular returns nothing and pool has 0 unused rows, swiped rows are served with `fallback_mode=True`.
- [ ] `pool_generator._recipes_for_step`: both the sparse-guard and the post-threshold-step fallback accept `"dinner"` in their meal-type sets.
- [ ] All existing `pool_generator` and `suggestion_service` tests still pass.
- [ ] All 20 tests in `test_sparse_pantry_resilience.py` pass.
- [ ] `rg 'c >= 0.50' backend/services/suggestion_service.py` returns zero matches (the hard-coded threshold is gone).
- [ ] Manual smoke (thin pantry scenario): create a test user with 2 confirmed staple items (confidence ~0.25 after first confirmation); call `GET /suggestions`; assert at least one non-empty tier in the response and `meta.fallback_mode == True`.
- [ ] Manual smoke (onboarding pool): trigger `POST /suggestions/pool/generate` with `trigger_reason="onboarding"` and a 2-item simulated pantry; confirm `dinner` slot has suggestions in the pool (staple fallback reached dinner).

### Logic Audit

- [ ] `_confidence_threshold_for_pantry_size` uses strict `<` comparisons; boundary values 3 and 10 yield the upper threshold of their range (3 items → 0.20, 10 items → 0.50). Verified by `THRESHOLD_THREE_ITEMS` and `THRESHOLD_TEN_ITEMS`.
- [ ] `missed_count` uses exact `== 0.0` comparison for confidence, not `< epsilon`. Verified by `MISSED_COUNT_ONE_MISSING_PRIMARY`.
- [ ] Soft-required missing ingredients do not inflate `missed_count`. Verified by `MISSED_COUNT_EXCLUDES_SOFT_REQUIRED_MISSING`.
- [ ] Empty pantry does not trigger last-resort or Spoonacular call. Verified by `EMPTY_PANTRY_DOES_NOT_CALL_SPOONACULAR`.
- [ ] Last-resort uses `is not None` on `base_ingredient` before adding to the set. Verified by code inspection.
- [ ] Swiped-pool last resort does not mutate pool row status. Verified by code inspection (read-only `get_pool_grouped_by_meal` call).
- [ ] Pool generator dinner fallback preserves the async event-loop pattern; no new `asyncio` imports added. Verified by diff of `_recipes_for_step`.
- [ ] `meta.fallback_mode` is `False` for large (≥ 10 item) pantries using the 0.50 threshold, regardless of how many tier slots are populated. Verified by `META_FALLBACK_FALSE_FOR_LARGE_PANTRY`.
- [ ] Measurable exit: new user with 3 confirmed staples receives a non-empty "What's for Dinner" within the cold-start < 3 min target (onboarding pool generation + pool-first path serve results without Spoonacular latency).
