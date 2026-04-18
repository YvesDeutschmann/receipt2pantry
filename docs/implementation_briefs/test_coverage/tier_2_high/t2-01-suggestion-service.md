# T2-01 — `backend/services/suggestion_service.py`

> **Tier:** 2 — High
> **Why risky:** 18 functions, tiered ranking + aspirational-dismiss penalty + 30-minute keyed cache. Tight coupling to `confidence_engine` internals (`_find_pantry_match`, `_to_date`). Existing test file is ~23 KB — mostly happy-path. Tier edges and cache invalidation are under-covered.

---

## 1. Technical Contract

- **File:** `backend/services/suggestion_service.py`
- **Key helpers:** `get_tier(min_required_confidence)`, `get_status_label(confidence, is_use_soon)`, `find_best_match(pantry_list, ingredient_name)`.
- **Constants:** `ASPIRATIONAL_DISMISS_THRESHOLD = 3`, `ASPIRATIONAL_CONFIDENCE_PENALTY = 0.15`, `SUGGESTION_CACHE_TTL_SECONDS = 1800`, `CANDIDATE_NUMBER = 50`.
- **Default prefs:** `{"depletion_multiplier": 1.0}`.
- **Dependencies:** `PantryService`, `RecipeService`, `SupabaseService`, `Config`, and confidence-engine internals.

---

## 2. Logic Guardrails

- **Tier cutoffs:** `>= 0.75` → `cook_tonight`, `>= 0.50` → `probably_have`, `>= 0.20` → `check_first`, else `suppressed`. Boundary values MUST land in the lower tier (inclusive at threshold).
- **Status labels:** `is_use_soon=True` overrides confidence label to `check_freshness` regardless of score.
- **Aspirational penalty:** after `ASPIRATIONAL_DISMISS_THRESHOLD` dismissals of a recipe, its confidence is reduced by `ASPIRATIONAL_CONFIDENCE_PENALTY`. Penalty applies at ranking time, never persisted.
- **Cache key stability:** caching must key on the inputs that affect ranking (pantry snapshot hash, user prefs, recipe candidate set id). A change in user prefs must invalidate.
- **Cache TTL:** entries older than 30 minutes are ignored. Test with injectable `now`.
- **No substring matching:** `find_best_match` MUST use exact equality or the canonical-name fuzzy matcher already in place (`SequenceMatcher`), never a Python `in`.
- **Coupling guard:** any rename of `_find_pantry_match` / `_to_date` in `confidence_engine` must break this module's tests first, not production.

---

## 3. Test-First Suite

Augment `tests/services/test_suggestion_service.py`.

### Test group A — tier math

1. `test_get_tier_at_exact_thresholds` (parametrized on 0.20, 0.50, 0.75, 0.749, 0.499)
2. `test_get_status_label_check_freshness_overrides_all_when_use_soon`
3. `test_get_status_label_returns_none_below_0_20`

### Test group B — aspirational penalty

4. `test_aspirational_penalty_applied_after_three_dismissals`
5. `test_aspirational_penalty_not_persisted_to_db`
6. `test_aspirational_penalty_does_not_flip_tier_by_itself` (confidence 0.90 → 0.75 is still `cook_tonight`)

### Test group C — cache behavior

7. `test_suggestion_cache_hit_returns_identical_payload`
8. `test_suggestion_cache_miss_when_user_prefs_change`
9. `test_suggestion_cache_expires_after_ttl_seconds` (inject `now`)

### Test group D — find_best_match

10. `test_find_best_match_returns_exact_match_when_available`
11. `test_find_best_match_prefers_canonical_over_substring` (regression against accidental `in`)

### Test group E — coupling

12. `test_confidence_engine_imports_resolved_at_import_time` (if `_find_pantry_match` is removed, this module's import fails — surfaces the coupling)

---

## 4. Definition of Done

- Boundary tests for all three tier thresholds exist and pin inclusive-lower behavior.
- Cache TTL test uses an injected clock; no `time.sleep`.
- Aspirational penalty test suite covers both the math and the non-persistence invariant.
- `find_best_match` substring-regression test is in place.
- Coupling guard (Test 12) is present and lightweight (import-only).
