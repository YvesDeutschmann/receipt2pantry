# T4-02 — `backend/services/recipe_service.py`

> **Tier:** 4 — Stable
> **Why worth testing:** Spoonacular is a paid external API — a regression that doubles call volume costs money. Uses an in-memory cache (`_cache`, `_details_cache`) with 1-hour TTLs; cache-key correctness is worth pinning.

---

## 1. Technical Contract

- **File:** `backend/services/recipe_service.py`
- **Class:** `RecipeService(pantry_service, config)`
- **Config reads:** `SPOONACULAR_API_KEY`, `SPOONACULAR_BASE_URL`, `SPOONACULAR_TIMEOUT`.
- **Methods (entry points):**
  - `get_recipes_by_pantry(household_id, user_id, ingredient_names, number=5)`
  - `get_recipe_details(recipe_id: int)`
  - `scale_recipe(details, member_count)`
- **Caches:** `_cache` (findByIngredients), `_details_cache` (per-recipe). TTL = 3600 s each.

---

## 2. Logic Guardrails

- **Cache hit bypasses HTTP:** same `(household_id, ingredient_set, number)` within 1 hour must not issue a new request.
- **Cache key order-independence:** `ingredient_names=["a", "b"]` and `["b", "a"]` should share a cache entry (sort first).
- **Missing API key:** no key → raise `ValidationException` at call time (not at construction — config may arrive later in tests).
- **HTTP timeout:** uses `config.SPOONACULAR_TIMEOUT`. Regression to no timeout would hang workers.
- **Error mapping:** Spoonacular 402/429 → `AIServiceException` (quota/rate-limit).
- **`scale_recipe` math:** linear scaling by `member_count / original_servings`. Integer unit quantities may become floats — acceptable; assert exact fraction math with floats tolerating small epsilon.
- **Zero/negative member count:** `scale_recipe` must reject (or clamp to 1) — pin current behavior.

---

## 3. Test-First Suite

Augment or create `tests/services/test_recipe_service.py`.

### Test group A — cache

1. `test_findByIngredients_second_call_within_ttl_hits_cache`
2. `test_cache_key_is_order_independent`
3. `test_cache_expires_after_ttl_seconds` (inject clock)
4. `test_details_cache_keyed_by_recipe_id_int`

### Test group B — HTTP contract

5. `test_get_recipes_by_pantry_uses_config_timeout`
6. `test_missing_api_key_raises_validation_exception`
7. `test_402_response_mapped_to_ai_service_exception`
8. `test_429_response_mapped_to_ai_service_exception`

### Test group C — scaling

9. `test_scale_recipe_doubles_amounts_for_double_members`
10. `test_scale_recipe_handles_missing_original_servings` (fallback to 1 or raise — pin behavior)
11. `test_scale_recipe_rejects_zero_member_count`

---

## 4. Definition of Done

- Cache-key order independence (test 2) enforced — prevents duplicated Spoonacular calls.
- Timeout pinned (test 5).
- HTTP 402/429 tests (7–8) prevent silent failures being interpreted as "no recipes".
- Scaling math tested with a few ratios (½, 2×, 1.5×).
- All `requests` calls mocked.
