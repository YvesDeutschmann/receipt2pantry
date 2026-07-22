# 02a — Suggestion Cost & Caching

> **Prerequisite:** Brief `01c-resync-idempotency.md` must be complete (backend re-sync dedup hardened). `SPOONACULAR_API_KEY` must be set in the environment; `RecipeService` raises `ValidationException` when it is absent and is the only gating check.
>
> **Scope:** Two production service files (`backend/services/recipe_service.py`, `backend/services/suggestion_service.py`), a trivial config extension (`backend/config.py`), and their tests. No frontend changes. No migration is required for MVP; see the Telemetry section for the post-MVP migration option.
>
> **Do NOT touch in this phase:** `backend/routes/` (routes are not changed), `backend/services/pool_generator.py`, `backend/services/pool_store_service.py`, `frontend/`, `supabase/migrations/`. Do not alter the TTL values of `_cache`, `_details_cache`, or `_result_cache`, or their eviction logic.

---

## Objective

Bound and measure Spoonacular usage so suggestions stay cheap and fast at launch scale. The pool already amortises calls by pre-generating recipes in the background; this brief (a) adds a per-period call budget + structured telemetry to `RecipeService`, (b) wires a pool-first fast path into `SuggestionService.get_recipe_suggestions()` so that a warm pool is served without any Spoonacular call, and (c) adds a graceful fallback when the budget is exhausted. The measurable exit conditions are: P95 warm "What's for Dinner" response < 2 s, and external Spoonacular calls per active user are bounded and logged.

---

## Technical Contract

### 1. `backend/config.py` (modified — additive only)

Add two new attributes with environment-variable backing and safe MVP defaults:

```python
SPOONACULAR_CALL_BUDGET: int          # env SPOONACULAR_CALL_BUDGET, default 500
SPOONACULAR_CALL_BUDGET_PERIOD_SECONDS: int  # env SPOONACULAR_CALL_BUDGET_PERIOD_SECONDS, default 3600
```

These are the only config changes. No other files read them except `RecipeService`.

---

### 2. `backend/services/recipe_service.py` (modified)

#### 2a. New telemetry state in `RecipeService.__init__`

Add after existing cache initialization:

```python
self._call_count: int = 0
self._period_call_count: int = 0
self._period_start: float = 0.0   # set to time.time() on first call
self._call_budget: int = config.SPOONACULAR_CALL_BUDGET
self._call_budget_period_s: int = config.SPOONACULAR_CALL_BUDGET_PERIOD_SECONDS
```

`_period_start` is initialised lazily on the first `_reset_period_if_elapsed` call so that tests can inject a controlled `now`.

#### 2b. New method: `_reset_period_if_elapsed(self, now: Optional[float] = None) -> None`

```
now = now if now is not None else time.time()
if self._period_start == 0.0 or (now - self._period_start) >= self._call_budget_period_s:
    self._period_call_count = 0
    self._period_start = now
```

#### 2c. New method: `is_budget_exceeded(self, now: Optional[float] = None) -> bool`

```
Calls _reset_period_if_elapsed(now) first.
Returns self._period_call_count >= self._call_budget.
```

Never raises. Never logs. Pure predicate.

#### 2d. New method: `_record_external_call(self, endpoint: str, now: Optional[float] = None) -> None`

Algorithm:
1. Call `_reset_period_if_elapsed(now)`.
2. Increment `self._call_count` and `self._period_call_count`.
3. Emit exactly one `logger.info` line as a JSON-serialised dict:

```python
{
    "event": "spoonacular_external_call",
    "endpoint": endpoint,           # "findByIngredients" or "recipeInformation"
    "period_count": self._period_call_count,
    "total_count": self._call_count,
    "budget": self._call_budget,
    "over_budget": self._period_call_count > self._call_budget,
}
```

No API key, user ID, ingredient names, or any PII appears in this log line.

#### 2e. New method: `get_call_stats(self, now: Optional[float] = None) -> Dict`

Returns a snapshot dict for monitoring/health endpoints:

```python
{
    "period_calls": int,
    "total_calls": int,
    "budget": int,
    "budget_period_seconds": int,
    "period_start_epoch": float,
    "budget_remaining": int,   # max(0, budget - period_calls)
}
```

Calls `_reset_period_if_elapsed(now)` first so stale periods are cleared before reporting.

#### 2f. Instrument `get_recipes_by_pantry`

Add the following two lines immediately after the cache-miss is confirmed (i.e., after the `if cached_entry and self._is_cache_valid(...)` block), and before `requests.get`:

```python
if self.is_budget_exceeded():
    raise AIServiceException("Spoonacular call budget exceeded for this period")
self._record_external_call("findByIngredients")
```

The existing 429 → `AIServiceException("Spoonacular API rate limit exceeded")` path is unchanged.

#### 2g. Instrument `get_recipe_details`

Add the following two lines immediately after the details-cache miss is confirmed (after the `if cached: ... return payload` block), before `requests.get`:

```python
if self.is_budget_exceeded():
    raise AIServiceException("Spoonacular call budget exceeded for this period")
self._record_external_call("recipeInformation")
```

**Telemetry storage decision:** In-memory only (per Flask worker process). Structured JSON log lines are queryable via any log aggregation tool (Datadog, CloudWatch, etc.) at MVP scale. A persistent `spoonacular_call_telemetry` DB table is **not** required for MVP. If the owner later wants cross-process or cross-restart aggregation, create migration `023` with columns `(user_id, household_id, endpoint, called_at, period_count)`. Do NOT add this migration now.

**Existing TTL review (no changes required):**
- `_cache_ttl = 3600` (findByIngredients): appropriate — pantry composition rarely changes within 1 hour.
- `_details_cache_ttl = 3600` (recipe details): appropriate — Spoonacular recipe content is static.

---

### 3. `backend/services/suggestion_service.py` (modified)

#### 3a. New import (TYPE_CHECKING guard)

```python
from __future__ import annotations
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from backend.services.pool_store_service import PoolStoreService
```

Use a string annotation `Optional["PoolStoreService"]` in the constructor to avoid a circular import at runtime.

#### 3b. Constructor injection of `pool_store`

```python
def __init__(
    self,
    supabase: SupabaseService,
    pantry_service: PantryService,
    recipe_service: RecipeService,
    config: Config,
    pool_store: Optional["PoolStoreService"] = None,
):
    ...
    self.pool_store = pool_store
```

Update `create_suggestion_service()` to accept and pass through `pool_store` (default `None`). Existing callers that omit it continue to work.

#### 3c. New module-level pure function: `_pool_grouped_to_suggestion_result`

```python
def _pool_grouped_to_suggestion_result(
    grouped: Dict[str, List[Dict]]
) -> Dict[str, List[Dict]]:
```

Algorithm:
1. For each pool row, read `match_score` (may be `None` or a `Decimal`). Convert to `float`; treat `None` as `0.0`.
2. Tier assignment based on `match_score`:
   - `>= 0.90` → `"cook_tonight"`
   - `>= 0.70` → `"probably_have"`
   - `< 0.70`  → `"check_first"`
3. Build card dict per row (skip rows where `recipe_id is None`):
   ```python
   {
       "id": str(row["recipe_id"]),
       "title": row["recipe_name"] or "",
       "image": row.get("recipe_image"),
       "tier": tier,
       "ingredient_flags": [],
       "score": float(match_score),
       "trigger_ingredient": None,
   }
   ```
4. Append each card to the appropriate tier list.
5. Sort each tier by `score` descending.
6. Return:
   ```python
   {
       "use_soon_shelf": [],
       "cook_tonight": [...],
       "probably_have": [...],
       "check_first": [...],
   }
   ```

This function is pure (no I/O, no DB, no Spoonacular). It is also used by the budget-exhaustion fallback.

#### 3d. Pool-first fast path in `get_recipe_suggestions`

Insert the following block **immediately after resolving `household_id`** and **before** loading the pantry or checking `_result_cache`:

```
if self.pool_store is not None:
    depth = self.pool_store.get_pool_depth(household_id)
    if sum(depth.values()) > 0:
        grouped = self.pool_store.get_pool_grouped_by_meal(household_id, status="unused")
        return _pool_grouped_to_suggestion_result(grouped)
```

Rationale: by checking pool depth before pantry loading, we skip all confidence computation and avoid any Spoonacular call when the pool is warm. The response shape is compatible with the existing SuggestionResult consumer; `ingredient_flags` is an empty list (acceptable for the card-swipe view; the full tiered scoring view kicks in only when the pool is cold).

`pool_store.get_pool_depth` and `pool_store.get_pool_grouped_by_meal` are existing methods on `PoolStoreService`; no changes to `PoolStoreService` are required.

#### 3e. Budget-exhaustion fallback in `get_recipe_suggestions`

Wrap the `fetch_candidate_recipes` call:

```python
try:
    candidates = self.fetch_candidate_recipes(user_id, household_id, ingredient_list)
except AIServiceException as exc:
    logger.warning("Spoonacular unavailable, attempting fallback: %s", exc)
    stale = self._result_cache.get(ck)
    if stale is not None:
        return stale[0]
    if self.pool_store is not None:
        grouped = self.pool_store.get_pool_grouped_by_meal(household_id, status="unused")
        if any(grouped.values()):
            return _pool_grouped_to_suggestion_result(grouped)
    raise
```

Wrap the `get_recipe_details` call inside the candidate loop:

```python
try:
    details = self.recipe_service.get_recipe_details(int(rid))
except AIServiceException:
    # Budget exhausted mid-loop: stop fetching details, return what we have scored so far.
    break
except Exception as e:
    logger.warning("Skipping recipe %s: %s", rid, e)
    continue
```

`is not None` checks: `stale` is checked with `is not None` (not falsy) so an empty-dict stale entry is not confused with a cache miss.

**Cache invalidation:** `invalidate_suggestion_cache` (called on dismiss) already clears `_result_cache`. The pool-first path bypasses `_result_cache` entirely so no additional invalidation is needed; pool state is managed by `PoolStoreService`.

**Existing `SUGGESTION_CACHE_TTL_SECONDS = 1800` review:** 30 minutes is appropriate — keep unchanged.

---

## Logic Guardrails

- `is_budget_exceeded` and `_record_external_call` must accept an optional `now` parameter for deterministic tests; never call `time.time()` without this escape hatch.
- `_record_external_call` must NOT be called on a cache hit. The budget counter tracks only actual HTTP requests.
- `_period_call_count` resets to 0 at the start of each new period; it must never accumulate across periods.
- The log line from `_record_external_call` must not contain the Spoonacular API key, user IDs, ingredient names, or any PII.
- `_pool_grouped_to_suggestion_result` must guard `row["recipe_id"] is not None` before building a card. Never use substring matching to resolve recipe IDs.
- Pool-first path: `sum(depth.values()) > 0` (not just truthiness of the dict) is the warm-pool gate — an all-zero depth dict is falsy-truthy but must fall through to Spoonacular.
- Budget-exhaustion fallback priority: stale `_result_cache` > pool > re-raise. Never silently swallow the exception when no fallback is available — the route layer must receive it.
- The existing 429 → `AIServiceException("Spoonacular API rate limit exceeded")` is functionally identical to a budget-exceeded exception from the caller's perspective; both trigger the same fallback ladder.
- Date/time determinism: all methods that call `time.time()` accept optional `now: Optional[float] = None`.
- Do not add `pool_store` as a required parameter; existing `create_suggestion_service` callers that omit it must continue to work unchanged.

---

## Test-First Suite

All tests live in `backend/tests/test_suggestion_cost_caching.py` and run with `pytest`. Mock `requests.get` and Supabase clients; do not make live network calls.

### RecipeService telemetry

- `RECIPE_CALL_BUDGET_NOT_EXCEEDED_ALLOWS_REQUEST` — period_call_count=0, budget=500 → `is_budget_exceeded` returns `False`.
- `RECIPE_CALL_BUDGET_EXCEEDED_RETURNS_TRUE` — period_call_count=500, budget=500, within period → `is_budget_exceeded` returns `True`.
- `RECIPE_NEW_PERIOD_RESETS_COUNTER` — period_call_count=500, then advance `now` by `budget_period_s + 1` → `is_budget_exceeded` returns `False`; `period_call_count` is 0.
- `RECIPE_RECORD_EXTERNAL_CALL_INCREMENTS_COUNTERS` — call `_record_external_call("findByIngredients")` twice → `_call_count` is 2, `_period_call_count` is 2.
- `RECIPE_RECORD_EXTERNAL_CALL_EMITS_LOG_LINE` — spy on `logger.info`; assert exactly one call; assert the JSON dict contains `"event": "spoonacular_external_call"` and `"endpoint": "findByIngredients"`; assert the raw string does not contain the API key.
- `RECIPE_GET_RECIPES_CACHE_HIT_NO_EXTERNAL_CALL` — populate `_cache` with a valid entry; call `get_recipes_by_pantry`; assert `requests.get` was never called and `_call_count` is 0.
- `RECIPE_GET_RECIPES_CACHE_MISS_RECORDS_CALL` — empty cache; call `get_recipes_by_pantry`; assert `requests.get` called once and `_call_count` is 1.
- `RECIPE_GET_RECIPES_BUDGET_EXCEEDED_RAISES` — set `_period_call_count = _call_budget`; call `get_recipes_by_pantry` without cache; assert `AIServiceException` raised, `requests.get` not called.
- `RECIPE_GET_DETAILS_CACHE_HIT_NO_EXTERNAL_CALL` — populate `_details_cache`; call `get_recipe_details`; assert `requests.get` not called and `_call_count` is 0.
- `RECIPE_GET_DETAILS_CACHE_MISS_RECORDS_CALL` — empty details cache; call `get_recipe_details`; assert `_call_count` is 1.
- `RECIPE_GET_DETAILS_BUDGET_EXCEEDED_RAISES` — budget exceeded; call `get_recipe_details` with cold cache; assert `AIServiceException`.
- `RECIPE_NO_DUPLICATE_LIVE_CALLS_WITHIN_TTL` — call `get_recipes_by_pantry` twice with identical args within TTL; assert `requests.get` called exactly once, `_call_count` is 1.
- `RECIPE_GET_CALL_STATS_RETURNS_EXPECTED_SHAPE` — after two recorded calls, assert `period_calls == 2`, `budget_remaining == budget - 2`.

### SuggestionService pool-first and fallback

- `POOL_GROUPED_TO_RESULT_TIER_COOK_TONIGHT` — row with `match_score=0.92` appears in `cook_tonight`.
- `POOL_GROUPED_TO_RESULT_TIER_PROBABLY_HAVE` — row with `match_score=0.75` appears in `probably_have`.
- `POOL_GROUPED_TO_RESULT_TIER_CHECK_FIRST` — row with `match_score=0.65` appears in `check_first`.
- `POOL_GROUPED_TO_RESULT_NONE_SCORE_DEFAULTS_TO_ZERO` — row with `match_score=None` → `score=0.0`, tier `"check_first"`.
- `POOL_GROUPED_TO_RESULT_SKIPS_NULL_RECIPE_ID` — row with `recipe_id=None` is omitted from all tiers.
- `SUGGESTION_POOL_FIRST_SKIPS_SPOONACULAR` — `pool_store.get_pool_depth` returns `{"breakfast":3,"lunch":2,"dinner":5}`; assert `recipe_service.get_recipes_by_pantry` never called; returned dict has `cook_tonight` or `probably_have` non-empty.
- `SUGGESTION_POOL_EMPTY_FALLS_THROUGH_TO_SPOONACULAR` — `pool_store.get_pool_depth` returns `{"breakfast":0,"lunch":0,"dinner":0}`; assert `recipe_service.get_recipes_by_pantry` called once.
- `SUGGESTION_NO_POOL_STORE_FALLS_THROUGH_TO_SPOONACULAR` — `pool_store=None`; assert `recipe_service.get_recipes_by_pantry` called.
- `SUGGESTION_BUDGET_EXHAUSTION_FALLS_BACK_TO_STALE_CACHE` — `fetch_candidate_recipes` raises `AIServiceException`; `_result_cache` has stale entry; assert stale entry returned, no pool DB call.
- `SUGGESTION_BUDGET_EXHAUSTION_FALLS_BACK_TO_POOL` — `AIServiceException` raised, no stale cache, pool has items; assert `_pool_grouped_to_suggestion_result` result returned.
- `SUGGESTION_BUDGET_EXHAUSTION_RERAISES_WHEN_NO_FALLBACK` — `AIServiceException` raised, no cache, empty pool; assert `AIServiceException` propagates.
- `SUGGESTION_DETAILS_BUDGET_EXHAUSTION_RETURNS_PARTIAL` — budget exhausted after first `get_recipe_details` call; assert scored results contain only the recipes successfully processed before exhaustion, no exception propagated.

---

## Definition of Done

- [ ] `backend/config.py` exposes `SPOONACULAR_CALL_BUDGET` (default 500) and `SPOONACULAR_CALL_BUDGET_PERIOD_SECONDS` (default 3600), both env-backed.
- [ ] `RecipeService` has `_record_external_call`, `_reset_period_if_elapsed`, `is_budget_exceeded`, `get_call_stats` methods matching the contracts above.
- [ ] `get_recipes_by_pantry` checks budget and records the call on every cache miss, before `requests.get`.
- [ ] `get_recipe_details` checks budget and records the call on every cache miss, before `requests.get`.
- [ ] `_record_external_call` log line is valid JSON and contains none of: API key, user ID, ingredient names.
- [ ] `SuggestionService.__init__` accepts `pool_store: Optional[PoolStoreService] = None`; `create_suggestion_service` passes it through.
- [ ] `_pool_grouped_to_suggestion_result` is a module-level pure function; no I/O.
- [ ] Pool-first path in `get_recipe_suggestions` is inserted before pantry loading; warm pool (depth > 0) returns without any call to `get_recipes_by_pantry` or `get_recipe_details`.
- [ ] Budget-exhaustion fallback ladder: stale cache → pool → re-raise, in that order, with `is not None` guards.
- [ ] Details-loop `AIServiceException` breaks the loop and returns partial scored results (no full exception).
- [ ] All existing `SuggestionService` tests still pass.
- [ ] All 13 tests in `test_suggestion_cost_caching.py` pass.
- [ ] `rg 'requests.get' backend/services/recipe_service.py` — verify every occurrence is preceded by the budget check.
- [ ] Manual smoke: with a warm pool (run `/suggestions/pool/generate` first), call `GET /suggestions`; confirm response time < 500 ms and `_call_count` does not increase.

### Logic Audit

- [ ] `_record_external_call` is never invoked on a cache hit (verify by code inspection and `RECIPE_GET_RECIPES_CACHE_HIT_NO_EXTERNAL_CALL` test).
- [ ] `is_budget_exceeded` resets the counter correctly across period boundaries (verified by `RECIPE_NEW_PERIOD_RESETS_COUNTER`).
- [ ] Pool-first path uses `sum(depth.values()) > 0`, not a truthy check on the depth dict (verified by `SUGGESTION_POOL_EMPTY_FALLS_THROUGH_TO_SPOONACULAR`).
- [ ] Stale cache check uses `is not None`, not falsy, so an empty cached result is still returned (verified by `SUGGESTION_BUDGET_EXHAUSTION_FALLS_BACK_TO_STALE_CACHE`).
- [ ] No PII appears in any log or telemetry surface (verified by `RECIPE_RECORD_EXTERNAL_CALL_EMITS_LOG_LINE`).
- [ ] Measurable exits: P95 warm "What's for Dinner" < 2 s (pool-first path measured via `GET /suggestions/pool/depth` latency + `GET /suggestions` with warm pool); external call budget ≤ 500/hour/process logged and queryable.
